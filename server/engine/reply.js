import fs from 'node:fs';
import path from 'node:path';
import { chat } from '../ai/llm.js';
import {
  applyBanned,
  buildMessages,
  buildSystemPrompt,
  extractStickerDirective,
  findStickerByName,
  matchKeyword,
  matchMemes,
  recalledKeywords,
  relevantMemories,
  resolveListTag,
} from './rules.js';
import { sendC2C, sendGroup, uploadMedia, sendMedia, splitText } from '../qq/api.js';
import {
  appendSession,
  bannedWords,
  config,
  getSession,
  keywords,
  memories,
  persona,
  pushLog,
  resetSession,
  stickers,
  touchConversation,
  touchIdentity,
  uid,
} from '../data.js';
import { hub } from '../hub.js';
import { UPLOAD_DIR } from '../paths.js';

/* ------------------------------------------------------------ 去重 / 缓存 */

const seenEvents = new Set();
const SEEN_LIMIT = 800;

function isDuplicate(id) {
  if (!id) return false;
  if (seenEvents.has(id)) return true;
  seenEvents.add(id);
  if (seenEvents.size > SEEN_LIMIT) {
    const first = seenEvents.values().next().value;
    seenEvents.delete(first);
  }
  return false;
}

/** sticker file_info 缓存：key = scope:openid:stickerId */
const mediaCache = new Map();

/** 黑名单「冷淡模式」的上次回复时间：key = peerId */
const coldLastReplyAt = new Map();

/* ------------------------------------------------------------ 事件归一化 */

const TEXT_EVENTS = {
  C2C_MESSAGE_CREATE: 'c2c',
  GROUP_AT_MESSAGE_CREATE: 'group',
  GROUP_MESSAGE_CREATE: 'group',
  AT_MESSAGE_CREATE: 'guild',
  DIRECT_MESSAGE_CREATE: 'guild',
};

/** 从 message_scene.ext 中取 msg_idx（引用回复要用的消息索引） */
function extractMsgIdx(data) {
  const ext = data?.message_scene?.ext;
  if (!Array.isArray(ext)) return '';
  for (const entry of ext) {
    if (typeof entry === 'string' && entry.startsWith('msg_idx=')) return entry.slice('msg_idx='.length);
  }
  return '';
}

export function describeEvent(type, data) {
  const scene = TEXT_EVENTS[type] || 'other';
  const msgIdx = extractMsgIdx(data);
  const rawName = data.author?.username || '';

  if (scene === 'c2c') {
    const userOpenid = data.author?.user_openid || data.author?.id || 'unknown';
    return {
      scene,
      scope: 'c2c',
      peerId: userOpenid,
      targetId: userOpenid,
      userOpenid,
      memberOpenid: '',
      groupId: '',
      openids: [userOpenid, data.author?.id].filter(Boolean),
      userName: rawName || `用户 ${String(userOpenid).slice(0, 6)}`,
      rawName,
      text: extractText(data),
      msgId: data.id,
      msgIdx,
    };
  }
  if (scene === 'group') {
    const memberId = data.author?.member_openid || data.author?.id || 'unknown';
    return {
      scene,
      scope: 'group',
      peerId: `${data.group_openid}:${memberId}`,
      targetId: data.group_openid,
      userOpenid: '',
      memberOpenid: memberId,
      groupId: data.group_openid,
      openids: [memberId, data.author?.id].filter(Boolean),
      userName: rawName || `群成员 ${String(memberId).slice(0, 6)}`,
      rawName,
      text: extractText(data),
      msgId: data.id,
      msgIdx,
    };
  }
  return null;
}

export function extractText(data) {
  const parts = [];
  if (typeof data.content === 'string' && data.content.trim()) parts.push(data.content.trim());

  for (const att of data.attachments || []) {
    const mime = att.content_type || '';
    if (mime === 'voice') {
      if (att.asr_refer_text) parts.push(`[语音] ${att.asr_refer_text}`);
      else parts.push('[语音消息，无法识别内容]');
    } else if (mime.startsWith('image/')) parts.push('[图片]');
    else if (mime.startsWith('video/')) parts.push('[视频]');
    else parts.push(`[文件 ${att.filename || ''}]`);
  }

  for (const el of data.msg_elements || []) {
    if (el?.content) parts.push(`[引用] ${el.content}`);
  }

  return parts.join(' ').trim();
}

/* -------------------------------------------------------------- 内建指令 */

const COMMANDS = {
  '/new': 'clear',
  '/reset': 'clear',
  '/清空': 'clear',
  '/重置': 'clear',
  '/help': 'help',
  '/帮助': 'help',
  '/ping': 'ping',
};

/* ---------------------------------------------------------------- 主流程 */

/**
 * 处理一条来自 QQ 的消息事件。
 * dryRun 为 true 时只生成回复内容，不发送（供控制台「实时试聊」使用）。
 */
export async function handleMessage(event, { dryRun = false } = {}) {
  const info = describeEvent(event.type, event.data);
  if (!info || !info.text) return null;
  if (!dryRun && isDuplicate(event.data?.id || event.eventId)) {
    hub.log('info', 'bot', '收到重复推送，已忽略', { quiet: true });
    return null;
  }

  const cfg = config.get();
  const { scope, peerId, targetId, text, userName } = info;

  /* 名单判定：基于 openid，与昵称无关 */
  const list = resolveListTag(info.openids || []);
  const notes = [];

  if (!dryRun && cfg.features.logMessages) {
    pushLog({
      kind: 'in',
      scope,
      peerId,
      targetId,
      userName,
      rawName: info.rawName,
      groupId: info.groupId,
      listTag: list.tag,
      text,
      eventType: event.type,
      msgId: info.msgId,
    });
  }

  /* 记录会话档案与身份档案，供「消息日志」按私聊/群聊浏览 */
  if (!dryRun) {
    touchConversation({
      scope,
      targetId,
      peerKey: info.memberOpenid || info.userOpenid,
      userName: info.rawName,
      direction: 'in',
      text,
    });
    touchIdentity({
      openid: info.memberOpenid || info.userOpenid,
      scope,
      name: info.rawName,
      groupId: info.groupId,
    });
  }

  hub.broadcast('message', {
    direction: 'in',
    scope,
    peerId,
    userName,
    listTag: list.tag,
    text,
    at: Date.now(),
  });
  hub.log('info', 'bot', `收到${scope === 'group' ? '群' : '单聊'}消息：${text.slice(0, 40)}`);

  /* 场景开关 */
  if (!dryRun) {
    if (scope === 'c2c' && !cfg.reply.privateEnabled) return null;
    if (scope === 'group' && !cfg.reply.groupEnabled) return null;
    // 群全量消息（GROUP_MESSAGE_CREATE）只有关闭「仅回应 @」时才会接话
    if (scope === 'group' && event.type === 'GROUP_MESSAGE_CREATE' && cfg.reply.groupRequireMention) return null;
  }

  appendSession(peerId, 'user', text);

  /* 黑名单：完全不回复 */
  if (!dryRun && list.tag === 'blacklist' && list.mode === 'ignore') {
    notes.push(`黑名单「${list.person?.alias || '未命名'}」：已按要求不回复`);
    hub.log('info', 'list', `黑名单对象发来消息，已忽略：${text.slice(0, 30)}`, { quiet: true });
    pushLog({ kind: 'blocked', scope, peerId, targetId, userName, text, reason: '黑名单：不回复' });
    return { reply: '', ignored: true, notes };
  }

  /* 黑名单：冷淡模式带冷却，避免被反复搭话 */
  if (!dryRun && list.tag === 'blacklist' && list.mode === 'cold') {
    const cooldown = (cfg.lists?.blacklistCooldown ?? 300) * 1000;
    const last = coldLastReplyAt.get(peerId) || 0;
    if (Date.now() - last < cooldown) {
      notes.push('黑名单冷淡模式：冷却中，本次不回复');
      pushLog({ kind: 'blocked', scope, peerId, targetId, userName, text, reason: '黑名单：冷却中' });
      return { reply: '', ignored: true, notes };
    }
    coldLastReplyAt.set(peerId, Date.now());
    notes.push('黑名单：冷淡回复');
  }

  /* 内建指令 */
  const command = COMMANDS[text.trim().toLowerCase()] || COMMANDS[text.trim()];
  if (command === 'clear') {
    resetSession(peerId);
    const reply = '会话已清空，我们重新开始吧。';
    if (!dryRun) await deliver(scope, targetId, { text: reply, msgId: info.msgId, msgIdx: info.msgIdx });
    return { reply, notes: ['已清空会话'] };
  }
  if (command === 'help') {
    const reply = [
      '我能做什么：',
      '· 像朋友一样和你聊天',
      '· 记住你告诉我的事',
      '· 认出你提到的梗',
      '',
      '指令：/new 清空会话 · /help 查看帮助',
    ].join('\n');
    if (!dryRun) await deliver(scope, targetId, { text: reply, msgId: info.msgId, msgIdx: info.msgIdx });
    return { reply, notes: ['帮助指令'] };
  }
  if (command === 'ping') {
    if (!dryRun) await deliver(scope, targetId, { text: 'pong', msgId: info.msgId, msgIdx: info.msgIdx });
    return { reply: 'pong', notes: [] };
  }

  /* 1. 违禁词：用户输入 */
  const inputCheck = applyBanned(text, 'input');
  if (inputCheck.hits.length) {
    notes.push(...inputCheck.hits.map((h) => `命中违禁词「${h.word}」`));
    bumpHits(bannedWords, inputCheck.hits);
  }
  if (inputCheck.blocked) {
    hub.log('warn', 'filter', `用户输入命中违禁词，已拦截：${text.slice(0, 30)}`);
    const notice = inputCheck.rule?.notice || '';
    if (!dryRun && notice) await deliver(scope, targetId, { text: notice, msgId: info.msgId, msgIdx: info.msgIdx });
    appendSession(peerId, 'assistant', notice || '（已拦截）');
    pushLog({ kind: 'blocked', scope, peerId, text, reason: inputCheck.rule?.word });
    return { reply: notice, blocked: true, notes };
  }

  /* 2. 关键词 */
  const keyword = matchKeyword(text);
  let extraSystem = '';
  if (keyword) {
    bumpHits(keywords, [{ id: keyword.id }]);
    notes.push(`命中关键词「${keyword.trigger}」`);
    if (keyword.mode === 'fixed') {
      let reply = String(keyword.reply || '').trim();
      const outCheck = applyBanned(reply, 'output');
      if (outCheck.blocked) return { reply: '', blocked: true, notes };
      reply = outCheck.text;
      if (!dryRun) {
        await deliver(scope, targetId, { text: reply, msgId: info.msgId, msgIdx: info.msgIdx });
      }
      appendSession(peerId, 'assistant', reply);
      pushLog({ kind: 'keyword', scope, peerId, text: reply, reason: keyword.trigger });
      return { reply, notes };
    }
    if (keyword.mode === 'ignore') {
      notes.push('按关键词设置忽略本条消息');
      return { reply: '', ignored: true, notes };
    }
    if (keyword.mode === 'recall') {
      // 触发式记忆：详情由 buildSystemPrompt 注入，这里只提示命中
      notes.push(`唤起关键词记忆「${keyword.trigger}」`);
    } else if (keyword.reply) {
      extraSystem = `本次对话请遵守这条额外要求：${keyword.reply}`;
    }
  }

  /* 3. 拼上下文并请求模型 */
  const hitMemes = matchMemes(text);
  if (hitMemes.length) notes.push(...hitMemes.map((m) => `命中梗「${m.term}」`));
  const usedMemories = relevantMemories(peerId, scope);
  if (usedMemories.length) notes.push(`注入 ${usedMemories.length} 条记忆`);
  const recalled = recalledKeywords(text);
  if (recalled.length) {
    const extra = recalled.filter((k) => k.id !== keyword?.id);
    if (extra.length) notes.push(...extra.map((k) => `唤起关键词记忆「${k.trigger}」`));
  }
  if (list.tag === 'whitelist') notes.push(`白名单「${list.person?.alias || '熟人'}」：更熟络`);

  let raw = '';
  try {
    const messages = buildMessages({ peerId, scope, userText: text, extraSystem, list });
    const result = await chat(messages);
    raw = result.content;
  } catch (err) {
    hub.log('error', 'ai', `生成回复失败：${err.message}`);
    const fallback = cfg.reply.errorNotice ? '抱歉，我这边刚刚走神了，稍后再试一次好吗？' : '';
    if (!dryRun && fallback) await deliver(scope, targetId, { text: fallback, msgId: info.msgId, msgIdx: info.msgIdx });
    pushLog({ kind: 'error', scope, peerId, text: err.message });
    return { reply: fallback, error: err.message, notes };
  }

  /* 4. 违禁词：模型输出 */
  const outputCheck = applyBanned(raw, 'output');
  if (outputCheck.blocked) {
    hub.log('warn', 'filter', '模型输出命中违禁词，已拦截');
    notes.push(`输出命中违禁词「${outputCheck.rule?.word}」`);
    const safe = outputCheck.rule?.notice || '这个话题我不太方便聊，我们换个话题吧。';
    if (!dryRun) await deliver(scope, targetId, { text: safe, msgId: info.msgId, msgIdx: info.msgIdx });
    appendSession(peerId, 'assistant', safe);
    pushLog({ kind: 'blocked', scope, peerId, text: raw, reason: outputCheck.rule?.word });
    return { reply: safe, blocked: true, notes };
  }

  /* 5. 表情包指令 */
  const { text: cleaned, names } = extractStickerDirective(outputCheck.text);
  const chosen = names.map(findStickerByName).filter(Boolean);
  if (names.length) notes.push(...names.map((n) => `表情包「${n}」`));

  const replyText = cleaned || (chosen.length ? '' : '……');

  if (!dryRun) {
    await deliver(scope, targetId, {
      text: replyText,
      sticker: chosen[0] || null,
      msgId: info.msgId,
      msgIdx: info.msgIdx,
    });
  }

  appendSession(peerId, 'assistant', replyText);
  pushLog({
    kind: 'out',
    scope,
    peerId,
    targetId,
    userName,
    listTag: list.tag,
    text: replyText,
    sticker: chosen[0]?.name,
  });
  if (!dryRun) {
    touchConversation({
      scope,
      targetId,
      peerKey: info.memberOpenid || info.userOpenid,
      userName: info.rawName,
      direction: 'out',
      text: replyText,
    });
  }
  hub.broadcast('message', { direction: 'out', scope, peerId, text: replyText, at: Date.now() });

  /* 6. 自动记忆（后台，不阻塞回复） */
  if (!dryRun && cfg.features.autoMemory) {
    maybeExtractMemory({ peerId, scope, userName }).catch((err) =>
      hub.log('warn', 'memory', `自动记忆失败：${err.message}`),
    );
  }

  return { reply: replyText, sticker: chosen[0] || null, notes };
}

/** 累加命中次数（hits / lastHitAt），用于列表页展示使用情况 */
function bumpHits(collection, hits) {
  if (!hits?.length) return;
  let changed = false;
  for (const hit of hits) {
    const item = collection.find(hit.id);
    if (!item) continue;
    item.hits = (item.hits || 0) + 1;
    item.lastHitAt = Date.now();
    changed = true;
  }
  if (changed) collection.persist();
}

/* ------------------------------------------------------------------ 发送 */

async function deliver(scope, targetId, { text, sticker, msgId, msgIdx, msgSeqStart = 1 }) {
  const cfg = config.get();
  const chunks = text ? splitText(text, cfg.reply.maxLength || 900) : [];
  const messageReference = cfg.reply.quoteReply && msgIdx ? { message_id: msgIdx } : null;
  let seq = msgSeqStart;

  for (const chunk of chunks) {
    const send = scope === 'group' ? sendGroup : sendC2C;
    await send(targetId, {
      content: chunk,
      msgType: 0,
      msgId,
      msgSeq: seq,
      // 引用只挂在第一条上，避免整屏都是引用条
      messageReference: seq === msgSeqStart ? messageReference : null,
    });
    seq += 1;
    if (chunks.length > 1) await new Promise((r) => setTimeout(r, 260));
  }

  if (sticker) {
    try {
      await sendSticker(scope, targetId, sticker, { msgId, msgSeq: seq });
    } catch (err) {
      hub.log('warn', 'sticker', `发送表情包失败：${err.message}`);
    }
  }
}

async function sendSticker(scope, targetId, sticker, { msgId, msgSeq }) {
  const filePath = path.join(UPLOAD_DIR, path.basename(sticker.file || ''));
  if (!sticker.file || !fs.existsSync(filePath)) throw new Error('表情包文件不存在');

  const cacheKey = `${scope}:${targetId}:${sticker.id}`;
  const cached = mediaCache.get(cacheKey);
  let fileInfo = cached && cached.expiresAt > Date.now() ? cached.fileInfo : null;

  if (!fileInfo) {
    const data = fs.readFileSync(filePath);
    const result = await uploadMedia(scope, targetId, {
      fileType: 1,
      fileData: data.toString('base64'),
      fileName: path.basename(filePath),
      srvSendMsg: false,
    });
    fileInfo = result.file_info;
    const ttl = Number(result.ttl) || 0;
    if (ttl > 0) mediaCache.set(cacheKey, { fileInfo, expiresAt: Date.now() + Math.max(ttl - 60, 60) * 1000 });
  }

  await sendMedia(scope, targetId, fileInfo, { msgId, msgSeq });
  const item = stickers.find(sticker.id);
  if (item) {
    item.usage = (item.usage || 0) + 1;
    item.lastUsedAt = Date.now();
    stickers.persist();
  }
  hub.log('info', 'sticker', `已发送表情包「${sticker.name}」`);
}

/* -------------------------------------------------------------- 自动记忆 */

const EXTRACT_PROMPT = `你是一个信息提取器，从对话里挑出**值得长期记住**的内容，分两类：

1) facts —— 关于用户本人的事实（称呼、偏好、身份、正在做的事、明确的要求）。
   键是简短主题，值是一句话。

2) topics —— 用户提到的**具体事物/事件**，将来再次提到时需要想起细节的东西（例如某个礼物、
   某个项目、某次约定、某个人的情况）。trigger 是将来会被提到的关键词（2~8 个字，取自用户
   的原话），detail 是要记住的全部细节（时间、预算、偏好、进展等，尽量完整）。

只输出 JSON，不要任何解释。没有就返回空数组。
{"facts":[{"key":"简短主题","value":"具体内容","weight":1}],
 "topics":[{"trigger":"关键词","detail":"这件事的完整细节","weight":2}]}

weight 取 1~3，越重要越大。facts 最多 3 条，topics 最多 2 条；每条 value/detail 不超过 80 字。
不要编造，只提取对话里真实出现过的信息。`;

async function maybeExtractMemory({ peerId, scope, userName }) {
  const cfg = config.get();
  const session = getSession(peerId);
  const every = Math.max(2, Number(cfg.features.autoMemoryEvery) || 8);
  if (session.messages.length < 4) return;
  if (session.messages.length - (session.autoMemoryAt || 0) < every) return;

  const transcript = session.messages
    .slice(-every)
    .map((m) => `${m.role === 'user' ? '用户' : '机器人'}：${m.content}`)
    .join('\n');

  const { content } = await chat(
    [
      { role: 'system', content: EXTRACT_PROMPT },
      { role: 'user', content: transcript },
    ],
    { temperature: 0, maxTokens: 400, json: true },
  );

  let parsed;
  try {
    parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, '').trim());
  } catch {
    return;
  }
  const facts = Array.isArray(parsed?.facts) ? parsed.facts.slice(0, 3) : [];
  const topics = Array.isArray(parsed?.topics) ? parsed.topics.slice(0, 2) : [];
  const sessionRef = getSession(peerId);
  sessionRef.autoMemoryAt = sessionRef.messages.length;

  for (const fact of facts) {
    if (!fact?.key || !fact?.value) continue;
    const existing = memories
      .list()
      .find((m) => m.scope === scope && String(m.target) === String(peerId) && m.key === fact.key);
    if (existing) {
      memories.update(existing.id, { value: fact.value, weight: fact.weight || existing.weight || 1 });
    } else {
      memories.add({
        id: uid(),
        scope,
        target: peerId,
        key: String(fact.key).slice(0, 30),
        value: String(fact.value).slice(0, 120),
        weight: Number(fact.weight) || 1,
        source: 'auto',
        enabled: true,
        createdAt: Date.now(),
      });
      hub.log('info', 'memory', `新增自动记忆：${fact.key}`);
    }
  }

  /* 关键词记忆：将来提到这个关键词时，把细节想起来 */
  for (const topic of topics) {
    if (!topic?.trigger || !topic?.detail) continue;
    const trigger = String(topic.trigger).slice(0, 20);
    const existing = keywords.list().find((k) => k.trigger === trigger);
    if (existing) {
      keywords.update(existing.id, { detail: topic.detail, updatedAt: Date.now() });
      hub.log('info', 'memory', `更新关键词记忆：${trigger}`);
    } else {
      keywords.add({
        id: uid(),
        trigger,
        matchType: 'contains',
        mode: 'recall',
        detail: String(topic.detail).slice(0, 200),
        priority: Number(topic.weight) || 1,
        cooldown: 0,
        source: 'auto',
        hits: 0,
        enabled: true,
        createdAt: Date.now(),
      });
      hub.log('info', 'memory', `新增关键词记忆：${trigger}`);
    }
  }

  if (facts.length || topics.length) hub.broadcast('stats:dirty', {});
}

/* ------------------------------------------------------------------ 预览 */

/** 控制台「实时试聊」：走完整规则链，但不发送、不写入会话 */
export async function previewReply(text, { peerId = 'console-preview', scope = 'user', openids = [] } = {}) {
  const p = persona.get();
  const cfg = config.get();
  const result = { text: '', sticker: null, notes: [], blocked: false, error: '' };

  const list = resolveListTag(openids);

  const inputCheck = applyBanned(text, 'input');
  if (inputCheck.hits.length) result.notes.push(...inputCheck.hits.map((h) => `命中违禁词「${h.word}」`));

  if (inputCheck.blocked) {
    result.blocked = true;
    result.text = inputCheck.rule?.notice || '（这条消息会被拦截，机器人不会回复）';
    return result;
  }

  const keyword = matchKeyword(text);
  if (keyword) {
    result.notes.push(`命中关键词「${keyword.trigger}」`);
    if (keyword.mode === 'ignore') {
      result.text = '（按关键词设置：忽略此消息）';
      return result;
    }
    if (keyword.mode === 'fixed') {
      result.text = String(keyword.reply || '');
      return result;
    }
  }

  const hitMemes = matchMemes(text);
  if (hitMemes.length) result.notes.push(...hitMemes.map((m) => `注入梗「${m.term}」`));
  const recalled = recalledKeywords(text);
  if (recalled.length) result.notes.push(...recalled.map((k) => `唤起关键词记忆「${k.trigger}」`));
  const mem = relevantMemories(peerId, scope);
  if (mem.length) result.notes.push(`注入 ${mem.length} 条记忆`);
  if (list.tag === 'whitelist') result.notes.push(`白名单「${list.person?.alias || '熟人'}」：更熟络`);
  if (list.tag === 'blacklist') {
    result.notes.push(`黑名单「${list.person?.alias || '受限用户'}」：${list.mode === 'ignore' ? '不回复' : '冷淡回复'}`);
    if (list.mode === 'ignore') {
      result.text = '（对方在黑名单里，按设置不会回复）';
      return result;
    }
  }

  if (!cfg.ai.apiKey || !cfg.ai.baseUrl || !cfg.ai.model) {
    result.notes.push('尚未配置 AI 模型，以下为规则层结果');
    result.text = p.greeting || '（未配置模型，无法生成回复）';
    return result;
  }

  const history = getSession(peerId);
  const messages = [
    { role: 'system', content: buildSystemPrompt({ peerId, scope, userText: text, list }) },
    ...(history.messages || []).slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: text },
  ];

  try {
    const { content } = await chat(messages, { maxTokens: Math.min(cfg.ai.maxTokens || 512, 512) });
    const outputCheck = applyBanned(content, 'output');
    if (outputCheck.blocked) {
      result.blocked = true;
      result.notes.push(`输出命中违禁词「${outputCheck.rule?.word}」`);
      result.text = outputCheck.rule?.notice || '（输出被拦截）';
      return result;
    }
    const { text: cleaned, names } = extractStickerDirective(outputCheck.text);
    result.text = cleaned;
    if (names.length) {
      const found = findStickerByName(names[0]);
      if (found) {
        result.sticker = { name: found.name, file: found.file };
        result.notes.push(`表情包「${found.name}」`);
      }
    }
  } catch (err) {
    result.error = err.message;
    result.text = `（生成失败：${err.message}）`;
  }
  return result;
}
