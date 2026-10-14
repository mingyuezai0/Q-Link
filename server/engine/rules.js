import { persona, memories, keywords, bannedWords, memes, stickers, people, findPersonByOpenid, normalizePersona, getSession, config } from '../data.js';

/* ------------------------------------------------------------- 违禁词引擎 */

export function testRule(rule, text) {
  const word = rule.word || '';
  if (!word) return false;
  switch (rule.matchType) {
    case 'exact':
      return text.trim() === word;
    case 'regex':
      try {
        return new RegExp(word, 'i').test(text);
      } catch {
        return false;
      }
    default:
      return text.toLowerCase().includes(word.toLowerCase());
  }
}

/**
 * 违禁词审查。scope 为 'input'（用户输入）或 'output'（模型输出）。
 * 返回 { blocked, text, hits }，blocked 为 true 时调用方应直接丢弃这条消息。
 */
export function applyBanned(text, scope) {
  const cfg = config.get();
  if (!cfg.features.banned) return { blocked: false, text, hits: [] };

  let out = text;
  const hits = [];

  const rules = bannedWords
    .list()
    .filter((r) => r.enabled !== false && (r.scope === 'all' || !r.scope || r.scope === scope))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  for (const rule of rules) {
    if (!testRule(rule, out)) continue;
    hits.push({ id: rule.id, word: rule.word, action: rule.action || 'block' });
    if (rule.action === 'replace') {
      const replacement = rule.replacement ?? '*';
      if (rule.matchType === 'regex') {
        try {
          out = out.replace(new RegExp(rule.word, 'gi'), replacement);
        } catch {
          /* 无效正则忽略 */
        }
      } else {
        out = out.split(rule.word).join(replacement);
      }
    } else if (rule.action === 'block') {
      return { blocked: true, text: out, hits, rule };
    }
  }

  return { blocked: false, text: out, hits };
}

/* --------------------------------------------------------------- 关键词 */

export function matchKeyword(text) {
  if (!config.get().features.keywords) return null;
  const list = keywords
    .list()
    .filter((k) => k.enabled !== false && k.trigger)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const k of list) {
    if (k.cooldown) {
      const last = k.lastHitAt || 0;
      if (Date.now() - last < k.cooldown * 1000) continue;
    }
    if (testRule({ word: k.trigger, matchType: k.matchType || 'contains' }, text)) {
      return k;
    }
  }
  return null;
}

/* --------------------------------------------------------------- 梗知识 */

export function matchMemes(text) {
  if (!config.get().features.memes) return [];
  const lower = text.toLowerCase();
  const hit = (m) => {
    const terms = [m.term, ...(m.alias || [])].filter(Boolean);
    return terms.some((t) => lower.includes(String(t).toLowerCase()));
  };
  return memes.list().filter((m) => m.enabled !== false && m.term && hit(m)).slice(0, 6);
}

/* --------------------------------------------------------------- 长期记忆 */

export function relevantMemories(peerId, scope) {
  if (!config.get().features.memory) return [];
  const list = memories.list().filter((m) => m.enabled !== false);
  return list
    .filter((m) => m.scope === 'global' || (m.scope === scope && String(m.target || '') === String(peerId)))
    .sort((a, b) => (b.weight ?? 1) - (a.weight ?? 1))
    .slice(0, 20);
}

/* ----------------------------------------------------------- 关键词记忆 */

/**
 * 「关键词」本质是**触发式记忆**：平时不占上下文，一旦用户提到这个词，
 * 就把它的详情取出来注入模型，避免重要的事被忘掉。
 */
export function recalledKeywords(text) {
  if (!config.get().features.keywords) return [];
  const list = keywords
    .list()
    .filter((k) => k.enabled !== false && k.trigger && (k.mode === 'recall' || k.detail))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const hit = [];
  for (const k of list) {
    if (testRule({ word: k.trigger, matchType: k.matchType || 'contains' }, text)) hit.push(k);
    if (hit.length >= 8) break;
  }
  return hit;
}

/* ------------------------------------------------------- 白名单 / 黑名单 */

/**
 * 名单匹配一律基于 openid，不基于昵称。
 * 官方接口不返回 QQ 号（运营规范也明确禁止获取），而 openid 是稳定的：
 * 用户改昵称、改头像都不会变，所以用它认人比 QQ 号更可靠。
 *
 * openids 传入本次消息中所有可用的身份标识（单聊是 user_openid，
 * 群聊是 member_openid），任意一个命中即算命中。
 */
export function resolveListTag(openids = []) {
  const cfg = config.get();
  if (!cfg.features.lists) return { tag: '', mode: '', person: null };

  for (const id of openids) {
    const person = findPersonByOpenid(id);
    if (!person || !person.listTag) continue;
    const mode =
      person.mode ||
      (person.listTag === 'whitelist' ? cfg.lists.whitelistMode : cfg.lists.blacklistMode);
    return { tag: person.listTag, mode, person };
  }
  return { tag: '', mode: '', person: null };
}

/* ---------------------------------------------------------- 表情包指令解析 */

const LENGTH_HINT = {
  short: '回复控制在 1~2 句、40 字以内。',
  medium: '回复控制在 2~4 句、120 字以内。',
  long: '可以展开讲清楚，但最多 300 字，用自然段落而不是列表。',
};

const EMOJI_HINT = {
  0: '不要使用任何 emoji 表情。',
  1: '克制使用 emoji，多数回复不带表情。',
  2: '自然地使用 emoji，让语气更亲切，但一条回复最多 1~2 个。',
  3: '可以较多地使用 emoji 表达情绪。',
};

/** 把 0~100 的滑杆值翻成一句给模型看的指令 */
function band(value, bands, fallback) {
  const v = Number(value);
  if (!Number.isFinite(v)) return fallback;
  for (const b of bands) if (v <= b.max) return b.text;
  return bands[bands.length - 1].text;
}

const describeTone = (v) =>
  band(
    v,
    [
      { max: 20, text: '语气安静克制，话不多，不主动热场。' },
      { max: 45, text: '语气平和自然，正常回应，不夸张。' },
      { max: 70, text: '语气亲切随和，像朋友聊天。' },
      { max: 88, text: '语气活泼俏皮，有精神，偶尔带点小得意。' },
      { max: 100, text: '语气非常活跃外放，情绪饱满，但不要浮夸到假。' },
    ],
    '语气亲切随和。',
  );

const describeLength = (v) =>
  band(
    v,
    [
      { max: 18, text: '回复极简，一句话以内，20 字左右。' },
      { max: 42, text: '回复简短，1~2 句，40 字以内。' },
      { max: 70, text: '回复适中，2~4 句，120 字以内。' },
      { max: 88, text: '可以展开讲清楚，最多 300 字，用自然段落而不是列表。' },
      { max: 100, text: '可以讲得很详细，必要时分点说明，但仍要口语化。' },
    ],
    '回复适中，2~4 句。',
  );

const describeEmoji = (v) =>
  band(
    v,
    [
      { max: 12, text: '不要使用任何 emoji。' },
      { max: 38, text: '克制使用 emoji，多数回复不带表情。' },
      { max: 72, text: '自然地使用 emoji，一条回复最多 1~2 个。' },
      { max: 100, text: '可以较多地使用 emoji 表达情绪，但别堆砌。' },
    ],
    '自然地使用 emoji，最多 1~2 个。',
  );

const describeHumor = (v) =>
  band(
    v,
    [
      { max: 22, text: '保持严肃，不开玩笑。' },
      { max: 58, text: '偶尔来一句轻松的调侃，点到为止。' },
      { max: 100, text: '可以常开玩笑、玩梗，让气氛轻松。' },
    ],
    '偶尔轻松一下。',
  );

const describeInitiative = (v) =>
  band(
    v,
    [
      { max: 22, text: '主要回答对方问的，不主动延伸话题，也不反问。' },
      { max: 58, text: '可以在结尾适度追问一句，把话接下去。' },
      { max: 100, text: '可以主动找话题、关心对方近况，像一个会主动找人聊天的朋友。' },
    ],
    '适度追问一句。',
  );

const describeFormality = (v) =>
  band(
    v,
    [
      { max: 22, text: '用词随意口语，可以带语气词和网络用语。' },
      { max: 62, text: '口语为主，但注意分寸，不用太跳脱的词。' },
      { max: 100, text: '用词正式得体，少用语气词，不说网络黑话。' },
    ],
    '口语为主，注意分寸。',
  );

export function buildSystemPrompt({ peerId, scope, userText, list = { tag: '', mode: '' } }) {
  const p = normalizePersona(persona.get()).persona;
  const lines = [];

  if (p.system) lines.push(p.system.trim());
  if (p.identity) lines.push(`你的身份：${p.identity}`);
  if (p.style) lines.push(`说话风格：${p.style}`);
  lines.push(`语气：${describeTone(p.tone)}`);
  lines.push(`长度要求：${describeLength(p.replyLength)}`);
  lines.push(`表情使用：${describeEmoji(p.emojiLevel)}`);
  lines.push(`幽默感：${describeHumor(p.humor)}`);
  lines.push(`主动性：${describeInitiative(p.initiative)}`);
  lines.push(`用词正式度：${describeFormality(p.formality)}`);
  if (p.signature) lines.push(`署名习惯：${p.signature}`);

  const rules = (p.rules || []).filter(Boolean);
  if (rules.length) {
    lines.push('行为准则：');
    rules.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }
  if (p.taboo) lines.push(`禁忌：${p.taboo}`);

  /* 白名单 / 黑名单带来的态度差异（由态度滑杆折算成档位） */
  if (list.tag === 'whitelist' && list.mode === 'warm') {
    const who = list.person?.alias ? `（你平时叫他「${list.person.alias}」）` : '';
    lines.push(
      '',
      `【当前对话对象是你的熟人${who}，可以更放得开】`,
      '语气更热络、更随意，可以主动关心近况、开点无伤大雅的玩笑，不用保持客气距离。',
    );
  } else if (list.tag === 'whitelist' && list.mode === 'devoted') {
    const who = list.person?.alias ? `（你平时叫他「${list.person.alias}」）` : '';
    lines.push(
      '',
      `【当前对话对象是你最熟的人${who}】`,
      '非常放得开：热情、亲近、会主动关心近况和情绪，可以调侃、可以接梗，像关系很好的老朋友。',
    );
  } else if (list.tag === 'blacklist') {
    if (list.mode === 'cold') {
      lines.push(
        '',
        '【当前对话对象在限制名单里】',
        '只做最低限度的回应：一到两句话，语气平淡克制，不主动延伸话题、不反问、不发图片。',
      );
    } else if (list.mode === 'normal') {
      lines.push('', '【当前对话对象在限制名单里】保持礼貌但疏远，不展开话题。');
    } else if (list.mode === 'ignore') {
      lines.push('', '【当前对话对象在限制名单里】系统已按设置决定不回复。');
    }
  }

  const hitMemes = matchMemes(userText || '');
  if (hitMemes.length) {
    lines.push('', '【本次对话涉及的梗，请按这里的解释理解，不要另作解释】');
    for (const m of hitMemes) {
      const parts = [`- ${m.term}：${m.meaning || ''}`];
      if (m.usage) parts.push(`（用法：${m.usage}）`);
      lines.push(parts.join(''));
    }
  }

  const mem = relevantMemories(peerId, scope);
  if (mem.length) {
    lines.push('', '【关于当前对话对象的长期记忆，自然使用，不要直接背出来】');
    for (const m of mem) lines.push(`- ${m.key}：${m.value}`);
  }

  /* 关键词记忆：用户提到某个关键词时，把它的详情取出来，避免忘掉重要的事 */
  const recalled = recalledKeywords(userText || '');
  if (recalled.length) {
    lines.push('', '【用户提到了这些关键词，它们各自记着一件重要的事，请自然地在对话里用上】');
    for (const k of recalled) {
      const detail = String(k.detail || k.reply || '').trim();
      const aliases = (k.alias || []).filter(Boolean);
      lines.push(`- ${k.trigger}${aliases.length ? `（也叫 ${aliases.join('、')}）` : ''}：${detail.replace(/\n/g, ' / ')}`);
    }
    lines.push('不要机械复述，也不要生硬地宣布"我想起来了"，按语境自然地提起。');
  }

  if (config.get().features.stickers) {
    const usable = stickers.list().filter((s) => s.enabled !== false).slice(0, 30);
    if (usable.length) {
      lines.push('', '【可用表情包】想在回复里发图时，在正文最后单独写一行 [sticker:名称]，系统会自动把图片发出去。');
      for (const s of usable) {
        const tags = (s.tags || []).filter(Boolean).join('/');
        lines.push(`- ${s.name}${tags ? `（${tags}）` : ''}`);
      }
    }
  }

  lines.push('', '只输出要发给对方的回复正文，不要输出思考过程、不要解释你在做什么。');
  return lines.join('\n');
}

export function buildMessages({ peerId, scope = 'user', userText, extraSystem = '', list }) {
  const cfg = config.get();
  const session = getSession(peerId);
  const history = session.messages.slice(-(cfg.ai.historyRounds || 8) * 2);

  const messages = [{ role: 'system', content: buildSystemPrompt({ peerId, scope, userText, list }) }];
  if (extraSystem) messages.push({ role: 'system', content: extraSystem });
  for (const m of history) messages.push({ role: m.role, content: m.content });
  messages.push({ role: 'user', content: userText });
  return messages;
}

/* ------------------------------------------------------- 表情包指令解包 */

export function extractStickerDirective(text) {
  const re = /\[sticker[:：]\s*([^\]]+)\]/g;
  const names = [];
  const cleaned = String(text).replace(re, (_, name) => {
    names.push(name.trim());
    return '';
  });
  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), names };
}

export function findStickerByName(name) {
  const target = String(name).trim().toLowerCase();
  const list = stickers.list().filter((s) => s.enabled !== false);
  return (
    list.find((s) => String(s.name).toLowerCase() === target) ||
    list.find((s) => String(s.name).toLowerCase().includes(target)) ||
    list.find((s) => (s.tags || []).some((t) => String(t).toLowerCase() === target)) ||
    null
  );
}
