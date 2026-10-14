import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_DIR, DATA_DIR, UPLOAD_DIR, BOTS_DIR } from './paths.js';
import {
  DEFAULT_INTENTS,
  activeBot,
  activeBotDir,
  activeBotId,
  activateBot,
  attitudeToMode,
  backfillFromLogs,
  bannedWords,
  bindOpenid,
  config,
  conversations,
  createBot,
  deleteBot,
  findPersonByOpenid,
  identities,
  keywords,
  listBots,
  logs,
  memories,
  memes,
  people,
  persona,
  resetSession,
  sessions,
  setConversationName,
  stats,
  stickers,
  uid,
  unbindOpenid,
  updateBotProfile,
} from './data.js';
import { hub } from './hub.js';
import { gateway } from './qq/gateway.js';
import { getMe, getToken, apiBase, clearToken, getGroupBotState, getGuildApiPermission, demandChannelApiPermission } from './qq/api.js';
import { beginQrConnect, cancelQr, qrState } from './qq/connect.js';
import { handleMessage, previewReply } from './engine/reply.js';
import { testConnection } from './ai/llm.js';

const app = express();
/** 默认端口；真正的监听端口由 startServer({ port }) 决定 */
const DEFAULT_PORT = Number(process.env.PORT || 3200);

app.use(express.json({ limit: '16mb' }));

/* 控制台页面：优先提供自包含的单文件版本（build.mjs 的产物），
   没有就回落到模块化的 public/index.html。 */
const SINGLE_FILE = path.join(PUBLIC_DIR, 'console.html');
const MODULAR = path.join(PUBLIC_DIR, 'index.html');

app.get('/', (req, res) => {
  res.sendFile(fs.existsSync(SINGLE_FILE) ? SINGLE_FILE : MODULAR);
});

app.use(express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1h' }));

const ok = (res, data) => res.json(data ?? { ok: true });
const fail = (res, err, code = 400) => res.status(code).json({ error: err?.message || String(err) });

/* ------------------------------------------------------------------ 状态 */

app.get('/api/status', (req, res) => {
  const cfg = config.get();
  ok(res, {
    ...gateway.status(),
    configured: Boolean(cfg.appId && cfg.appSecret),
    aiConfigured: Boolean(cfg.ai.baseUrl && cfg.ai.model && cfg.ai.apiKey),
    baseUrl: apiBase(),
  });
});

app.get('/api/stats', (req, res) => ok(res, stats()));

app.get('/api/intents', (req, res) => ok(res, DEFAULT_INTENTS));

/* ------------------------------------------------------------ 机器人管理 */

app.get('/api/bots', (req, res) =>
  ok(res, { activeId: activeBotId(), bots: listBots() }),
);

app.post('/api/bots', (req, res) => {
  try {
    const { name, copyFrom } = req.body || {};
    const bot = createBot({ name: name || '新机器人', source: 'manual' });

    // 可选：从当前机器人复制人设与词库，省得重新调一遍
    if (copyFrom) {
      const from = activeBotDir();
      const to = path.join(BOTS_DIR, bot.id);
      fs.mkdirSync(to, { recursive: true });
      for (const file of ['persona.json', 'keywords.json', 'banned.json', 'memes.json', 'memories.json']) {
        const src = path.join(from, file);
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(to, file));
      }
    }

    hub.log('ok', 'bots', `已新建机器人「${bot.name}」`);
    ok(res, { bot, activeId: activeBotId() });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/bots/:id/activate', (req, res) => {
  try {
    const id = req.params.id;
    if (id === activeBotId()) return ok(res, { bot: activeBot(), unchanged: true });

    // 切换机器人必须断开旧凭据建立的连接，否则会用错身份收发消息
    gateway.stop();
    const bot = activateBot(id);
    hub.broadcast('bots:changed', { activeId: id });
    hub.log('info', 'bots', `已切换到机器人「${bot.name}」`);

    const cfg = config.get();
    if (cfg.autoConnect && cfg.appId && cfg.appSecret) {
      setTimeout(() => {
        hub.log('info', 'gateway', '已开启自动连接，正在为该机器人上线…');
        gateway.start().catch((err) => hub.log('error', 'gateway', err.message));
      }, 400);
    }
    ok(res, { bot, status: gateway.status() });
  } catch (err) {
    fail(res, err);
  }
});

app.put('/api/bots/:id', (req, res) => {
  try {
    const bot = updateBotProfile(req.params.id, req.body || {});
    hub.broadcast('bots:changed', { activeId: activeBotId() });
    ok(res, bot);
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/bots/:id', (req, res) => {
  try {
    if (req.params.id === activeBotId()) gateway.stop();
    const bot = deleteBot(req.params.id);
    hub.log('warn', 'bots', `已删除机器人，当前为「${bot.name}」`);
    hub.broadcast('bots:changed', { activeId: activeBotId() });
    ok(res, { activeId: activeBotId(), bots: listBots() });
  } catch (err) {
    fail(res, err);
  }
});

/* ------------------------------------------------- 当前机器人的资料同步 */

/**
 * 修改当前机器人的昵称 / 头像。
 * 说明：QQ 开放平台并未提供由机器人自行修改昵称头像的 OpenAPI（官方要求在开放平台
 * 管理端修改），因此这里只更新本地档案，并把"平台侧不支持"如实返回给前端。
 */
app.put('/api/bot/profile', (req, res) => {
  try {
    const { name, avatar } = req.body || {};
    const bot = updateBotProfile(activeBotId(), { name, avatar });
    const p = persona.get();
    persona.patch({ name: bot.name, avatar: bot.avatar, updatedAt: Date.now() });
    hub.broadcast('bots:changed', { activeId: activeBotId() });
    hub.log('info', 'bots', `机器人资料已更新：${bot.name}`);
    ok(res, {
      bot,
      persona: p,
      platformSynced: false,
      platformNote:
        'QQ 开放平台未提供修改机器人昵称/头像的开放接口，这部分只保存在本机。要改 QQ 里显示的头像昵称，需在 QQ 开放平台管理端修改。',
    });
  } catch (err) {
    fail(res, err);
  }
});

/* -------------------------------------------------------------- 名单管理 */

/**
 * 白名单 / 黑名单。
 *
 * 数据模型上它们是同一份 people 集合，靠 listTag 区分 —— 因为「同一个人」在这台机器人下
 * 可能同时有单聊 openid 和若干个群的 member_openid，必须绑在一个人的身上才能一致对待。
 */
const LIST_TAGS = ['whitelist', 'blacklist', ''];

function sanitizePerson(input = {}, forcedTag) {
  const person = {};
  if (forcedTag !== undefined) person.listTag = forcedTag;
  else if (input.listTag !== undefined) person.listTag = LIST_TAGS.includes(input.listTag) ? input.listTag : '';

  if (input.alias !== undefined) person.alias = String(input.alias || '').slice(0, 30);
  if (input.note !== undefined) person.note = String(input.note || '').slice(0, 200);
  if (input.enabled !== undefined) person.enabled = Boolean(input.enabled);

  // QQ 号只作个人备注：官方接口不返回它，匹配一律靠 openid
  if (input.qq !== undefined) person.qq = String(input.qq || '').replace(/\D/g, '').slice(0, 12);

  // 态度用 0~100 滑杆表达，mode 由它推导，保证规则层和旧数据都能用
  if (input.attitude !== undefined) {
    const attitude = Math.min(100, Math.max(0, Number(input.attitude) || 0));
    person.attitude = attitude;
    person.mode = attitudeToMode(attitude);
  } else if (input.mode !== undefined) {
    person.mode = String(input.mode || '');
  }
  return person;
}

app.get('/api/people', (req, res) => {
  const tag = req.query.list;
  const list = people.list().filter((p) => (tag ? p.listTag === tag : true));
  ok(res, list);
});

app.post('/api/people', (req, res) => {
  try {
    const { listTag = 'whitelist', scope = '', groupId = '', name = '' } = req.body || {};
    const openid = String(req.body?.openid || '').trim();
    const item = {
      id: uid(),
      alias: '',
      note: '',
      mode: '',
      enabled: true,
      openids: openid ? [{ openid, scope, groupId, name, count: 1, firstAt: Date.now(), lastAt: Date.now() }] : [],
      createdAt: Date.now(),
      ...sanitizePerson(req.body || {}, LIST_TAGS.includes(listTag) ? listTag : 'whitelist'),
    };
    // 同一个人不要重复加进同一份名单
    if (openid) {
      const dup = findPersonByOpenid(openid);
      if (dup) throw new Error(`这个 openid 已经属于「${dup.alias || '未命名'}」，请直接编辑那一条`);
    }
    people.add(item);
    hub.log('info', 'lists', `已加入${item.listTag === 'blacklist' ? '黑' : '白'}名单`);
    hub.broadcast('stats:dirty', {});
    ok(res, item);
  } catch (err) {
    fail(res, err);
  }
});

app.put('/api/people/:id', (req, res) => {
  try {
    const updated = people.update(req.params.id, sanitizePerson(req.body || {}));
    if (!updated) throw new Error('这位用户不存在');
    hub.broadcast('stats:dirty', {});
    ok(res, updated);
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/people/:id', (req, res) => {
  try {
    if (!people.remove(req.params.id)) throw new Error('这位用户不存在');
    hub.broadcast('stats:dirty', {});
    ok(res, { ok: true });
  } catch (err) {
    fail(res, err);
  }
});

/** 把另一个场景观察到的 openid 绑到同一个人身上（单聊一个、每个群一个） */
app.post('/api/people/:id/openids', (req, res) => {
  try {
    const { openid, scope = '', groupId = '', name = '' } = req.body || {};
    if (!openid) throw new Error('缺少 openid');
    const owner = findPersonByOpenid(openid);
    if (owner && owner.id !== req.params.id) {
      throw new Error(`这个 openid 已经绑在「${owner.alias || '未命名'}」身上了`);
    }
    ok(res, bindOpenid(req.params.id, { openid, scope, groupId, name }));
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/people/:id/openids/:openid', (req, res) => {
  try {
    ok(res, unbindOpenid(req.params.id, decodeURIComponent(req.params.openid)));
  } catch (err) {
    fail(res, err);
  }
});

/** 从日志里一键拉人：把观察到的 openid 直接加进某份名单 */
app.post('/api/people/quick', (req, res) => {
  try {
    const { openid, listTag = 'whitelist', alias = '', mode = '', scope = '', groupId = '', name = '' } = req.body || {};
    if (!openid) throw new Error('缺少 openid');

    const existing = findPersonByOpenid(openid);
    if (existing) {
      const updated = people.update(existing.id, {
        listTag: LIST_TAGS.includes(listTag) ? listTag : 'whitelist',
        alias: alias || existing.alias,
        mode: mode || existing.mode,
      });
      hub.log('info', 'lists', `已更新名单归属`);
      hub.broadcast('stats:dirty', {});
      return ok(res, { person: updated, updated: true });
    }

    const item = {
      id: uid(),
      alias: String(alias || name || '').slice(0, 30),
      note: '',
      mode: String(mode || ''),
      listTag: LIST_TAGS.includes(listTag) ? listTag : 'whitelist',
      enabled: true,
      openids: [{ openid: String(openid), scope, groupId, name: name || '', count: 1, firstAt: Date.now(), lastAt: Date.now() }],
      createdAt: Date.now(),
    };
    people.add(item);
    hub.log('info', 'lists', `已加入${item.listTag === 'blacklist' ? '黑' : '白'}名单：${item.alias || openid.slice(0, 8)}`);
    hub.broadcast('stats:dirty', {});
    ok(res, { person: item, updated: false });
  } catch (err) {
    fail(res, err);
  }
});

/** 见过的用户，供名单页直接挑选，不用手动抄 openid */
app.get('/api/identities', (req, res) => {
  const list = Object.values(identities.get())
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
    .slice(0, 300)
    .map((item) => {
      const person = findPersonByOpenid(item.openid);
      return {
        ...item,
        listTag: person?.listTag || '',
        personId: person?.id || '',
        personAlias: person?.alias || '',
      };
    });
  ok(res, list);
});

/* ------------------------------------------------------ 会话（消息日志） */

app.get('/api/conversations', (req, res) => {
  const all = Object.values(conversations.get()).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  ok(
    res,
    all.map((conv) => ({
      ...conv,
      memberCount: Object.keys(conv.members || {}).length,
    })),
  );
});

app.get('/api/conversations/:id/messages', (req, res) => {
  const cid = decodeURIComponent(req.params.id);
  const conv = conversations.get()[cid];
  if (!conv) return fail(res, new Error('会话不存在'), 404);
  const limit = Math.min(Number(req.query.limit) || 200, 600);
  const messages = logs
    .list()
    .filter((item) => item.scope === conv.scope && String(item.targetId) === String(conv.targetId))
    .slice(0, limit)
    .reverse();
  ok(res, { conversation: conv, messages });
});

app.put('/api/conversations/:id', (req, res) => {
  try {
    const conv = setConversationName(decodeURIComponent(req.params.id), req.body?.name);
    if (!conv) throw new Error('会话不存在');
    ok(res, conv);
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/conversations/:id', (req, res) => {
  try {
    const cid = decodeURIComponent(req.params.id);
    const all = conversations.get();
    const conv = all[cid];
    if (conv) {
      delete all[cid];
      conversations.persist();
      // 同时清掉该会话下所有成员的上下文
      for (const key of Object.keys(conv.members || {})) resetSession(key);
    }
    ok(res, { ok: true });
  } catch (err) {
    fail(res, err);
  }
});

/* ------------------------------------------------------------ 接入配置 */

app.get('/api/config', (req, res) => ok(res, { ...config.get(), apiBase: apiBase() }));

app.put('/api/config', (req, res) => {
  try {
    const patch = { ...(req.body || {}) };
    delete patch.apiBase;
    if (patch.ai) patch.ai = { ...config.get().ai, ...patch.ai };
    if (patch.reply) patch.reply = { ...config.get().reply, ...patch.reply };
    if (patch.features) patch.features = { ...config.get().features, ...patch.features };
    patch.updatedAt = Date.now();

    const before = config.get();
    const next = config.patch(patch);
    if (before.appId !== next.appId || before.appSecret !== next.appSecret || before.sandbox !== next.sandbox) {
      clearToken();
      hub.log('info', 'config', '接入凭证已更新');
    }
    ok(res, { ...next, apiBase: apiBase() });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/config/test', async (req, res) => {
  try {
    const token = await getToken({ force: true });
    const me = await getMe();
    hub.log('ok', 'connect', `鉴权成功：${me.username || me.id}`);
    ok(res, {
      ok: true,
      tokenTail: `${String(token).slice(0, 6)}…${String(token).slice(-4)}`,
      bot: { id: me.id, username: me.username, avatar: me.avatar },
    });
  } catch (err) {
    hub.log('error', 'connect', `鉴权失败：${err.message}`);
    fail(res, err);
  }
});

app.post('/api/config/test-ai', async (req, res) => {
  try {
    const result = await testConnection(req.body || {});
    ok(res, result);
  } catch (err) {
    fail(res, err);
  }
});

/* --------------------------------------------------------------- 扫码接入 */

app.get('/api/qr', (req, res) => ok(res, qrState()));

app.post('/api/qr/start', async (req, res) => {
  try {
    ok(res, await beginQrConnect());
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/qr/cancel', (req, res) => ok(res, cancelQr()));

/* ------------------------------------------------------------------ 机器人 */

app.post('/api/bot/start', async (req, res) => {
  try {
    const cfg = config.get();
    if (!cfg.appId || !cfg.appSecret) throw new Error('请先完成接入配置（填写或扫码获取 AppID / AppSecret）');
    gateway.start().catch((err) => hub.log('error', 'gateway', `启动失败：${err.message}`));
    ok(res, { status: gateway.status() });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/bot/stop', (req, res) => {
  gateway.stop();
  ok(res, { status: gateway.status() });
});

app.post('/api/bot/restart', async (req, res) => {
  try {
    const cfg = config.get();
    if (!cfg.appId || !cfg.appSecret) throw new Error('请先完成接入配置');
    gateway.restart().catch((err) => hub.log('error', 'gateway', `重启失败：${err.message}`));
    ok(res, { status: gateway.status() });
  } catch (err) {
    fail(res, err);
  }
});

/* ------------------------------------------------------------------ 人设 */

app.get('/api/persona', (req, res) => ok(res, persona.get()));

app.put('/api/persona', (req, res) => {
  try {
    const before = persona.get();
    const next = persona.patch({ ...(req.body || {}), updatedAt: Date.now() });
    if (before.avatar !== next.avatar) hub.broadcast('persona', next);
    hub.log('info', 'persona', '人设已更新');
    ok(res, next);
  } catch (err) {
    fail(res, err);
  }
});

/* ------------------------------------------------------ 通用集合 CRUD */

function registerCollection(basePath, collection, { blank, label }) {
  app.get(basePath, (req, res) => ok(res, collection.list()));

  app.post(basePath, (req, res) => {
    try {
      const item = {
        ...blank(),
        ...(req.body || {}),
        id: uid(),
        enabled: req.body?.enabled !== false,
        hits: 0,
        createdAt: Date.now(),
      };
      collection.add(item);
      hub.log('info', 'data', `新增${label}`);
      hub.broadcast('stats:dirty', {});
      ok(res, item);
    } catch (err) {
      fail(res, err);
    }
  });

  app.put(`${basePath}/:id`, (req, res) => {
    try {
      const patch = { ...(req.body || {}) };
      delete patch.id;
      const updated = collection.update(req.params.id, patch);
      if (!updated) throw new Error(`${label}不存在`);
      hub.broadcast('stats:dirty', {});
      ok(res, updated);
    } catch (err) {
      fail(res, err);
    }
  });

  app.delete(`${basePath}/:id`, (req, res) => {
    try {
      if (!collection.remove(req.params.id)) throw new Error(`${label}不存在`);
      hub.broadcast('stats:dirty', {});
      ok(res, { ok: true });
    } catch (err) {
      fail(res, err);
    }
  });
}

registerCollection('/api/memories', memories, {
  label: '记忆',
  blank: () => ({ scope: 'global', target: '', key: '', value: '', weight: 1, source: 'manual', enabled: true }),
});

registerCollection('/api/keywords', keywords, {
  label: '关键词',
  blank: () => ({ trigger: '', matchType: 'contains', mode: 'fixed', reply: '', priority: 0, cooldown: 0, enabled: true }),
});

registerCollection('/api/banned', bannedWords, {
  label: '违禁词',
  blank: () => ({
    word: '',
    matchType: 'contains',
    action: 'block',
    replacement: '*',
    scope: 'all',
    notice: '',
    priority: 100,
    enabled: true,
  }),
});

registerCollection('/api/memes', memes, {
  label: '梗知识',
  blank: () => ({ term: '', alias: [], meaning: '', usage: '', tags: [], enabled: true }),
});

registerCollection('/api/stickers', stickers, {
  label: '表情包',
  blank: () => ({ name: '新表情包', tags: [], file: '', mime: '', size: 0, usage: 0, enabled: true }),
});

/* -------------------------------------------------------------- 图片上传 */

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** 保存一张 base64 图片，返回文件名与可访问路径 */
function saveImage({ mime, data, prefix = '' }) {
  if (!data) throw new Error('没有收到图片数据');
  if (!EXT_BY_MIME[mime]) throw new Error('仅支持 PNG / JPG / GIF / WebP 图片');
  const buffer = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (buffer.length > 4.5 * 1024 * 1024) throw new Error('图片超过 4.5MB，QQ 单次上传上限为 5MB');
  const fileName = `${prefix}${uid()}${EXT_BY_MIME[mime]}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
  return { fileName, bytes: buffer.length };
}

/** 通用图片上传（头像等），只落盘不建记录 */
app.post('/api/upload', (req, res) => {
  try {
    const { fileName, bytes } = saveImage(req.body || {});
    ok(res, { file: fileName, url: `/uploads/${fileName}`, size: bytes });
  } catch (err) {
    fail(res, err);
  }
});

/* -------------------------------------------------------------- 表情包上传 */

app.post('/api/stickers/upload', (req, res) => {
  try {
    const { name, mime, data, tags } = req.body || {};
    const { fileName, bytes } = saveImage({ mime, data });

    const item = {
      id: uid(),
      name: String(name || '未命名表情包').slice(0, 40),
      tags: Array.isArray(tags) ? tags : [],
      file: fileName,
      url: `/uploads/${fileName}`,
      mime,
      size: bytes,
      enabled: true,
      usage: 0,
      createdAt: Date.now(),
    };
    stickers.add(item);
    hub.log('ok', 'sticker', `已上传表情包「${item.name}」`);
    hub.broadcast('stats:dirty', {});
    ok(res, item);
  } catch (err) {
    fail(res, err);
  }
});

/* ---------------------------------------------------------------- 试聊 */

app.post('/api/preview', async (req, res) => {
  try {
    const { text, peerId } = req.body || {};
    if (!text || !String(text).trim()) throw new Error('请输入一句话');
    const result = await previewReply(String(text).trim(), { peerId: peerId || 'console-preview' });
    ok(res, result);
  } catch (err) {
    fail(res, err);
  }
});

/* ---------------------------------------------------------------- 日志 */

app.get('/api/logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 600);
  ok(res, logs.list().slice(0, limit));
});

/** 运行日志（内存保留最近 300 条，进程重启即清空） */
app.get('/api/runtime-logs', (req, res) => ok(res, hub.logHistory.slice(-300)));
app.delete('/api/logs', (req, res) => {
  logs.replaceAll([]);
  ok(res, { ok: true });
});

app.get('/api/sessions', (req, res) => {
  const all = sessions.get();
  const list = Object.entries(all)
    .map(([peerId, value]) => ({
      peerId,
      lastAt: value.lastAt,
      turns: value.messages?.length || 0,
      preview: value.messages?.slice(-1)[0]?.content?.slice(0, 60) || '',
    }))
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
    .slice(0, 100);
  ok(res, list);
});

app.delete('/api/sessions/:peerId', (req, res) => {
  resetSession(decodeURIComponent(req.params.peerId));
  ok(res, { ok: true });
});

/* ---------------------------------------------------------------- 导出 */

app.get('/api/export', (req, res) => {
  res.setHeader('content-disposition', `attachment; filename="qqbot-console-${Date.now()}.json"`);
  ok(res, {
    exportedAt: Date.now(),
    persona: persona.get(),
    memories: memories.list(),
    keywords: keywords.list(),
    banned: bannedWords.list(),
    memes: memes.list(),
    stickers: stickers.list().map(({ ...s }) => s),
    config: { ...config.get(), appSecret: '' },
  });
});

app.post('/api/import', (req, res) => {
  try {
    const body = req.body || {};
    if (Array.isArray(body.memories)) memories.replaceAll(body.memories);
    if (Array.isArray(body.keywords)) keywords.replaceAll(body.keywords);
    if (Array.isArray(body.banned)) bannedWords.replaceAll(body.banned);
    if (Array.isArray(body.memes)) memes.replaceAll(body.memes);
    if (Array.isArray(body.stickers)) {
      const merged = [...stickers.list()];
      for (const item of body.stickers) {
        if (!merged.some((s) => s.id === item.id)) merged.push(item);
      }
      stickers.replaceAll(merged);
    }
    if (body.persona && typeof body.persona === 'object') persona.patch(body.persona);
    hub.log('ok', 'data', '配置导入完成');
    hub.broadcast('stats:dirty', {});
    ok(res, { ok: true, stats: stats() });
  } catch (err) {
    fail(res, err);
  }
});

/* ------------------------------------------------ 平台侧权限（能读到什么） */

/**
 * 读取平台侧的真实权限状态。
 *
 * 官方文档确认：这 5 项开关**没有任何可写的 OpenAPI**，只能在 QQ 开放平台管理端、
 * 或由用户/群主在 QQ 客户端里操作。所以这里只做「读」：
 *  - 每个已知群：GET /v2/groups/{group_openid}/bot_state → 消息接收范围、能否主动推送、机器人角色
 *    （文档标注「仅白名单机器人可用」，非白名单返回 11253，这里如实呈现）
 *  - 能读到就展示真值，读不到就说读不到，不做任何假装同步的写入。
 */
app.get('/api/platform/groups', async (req, res) => {
  try {
    const groups = Object.values(conversations.get()).filter((c) => c.scope === 'group');
    if (!groups.length) return ok(res, { groups: [], note: '还没有加入任何群聊，无法读取群内权限状态。' });

    const results = [];
    for (const conv of groups.slice(0, 20)) {
      const item = {
        groupOpenid: conv.targetId,
        name: conv.name && conv.name !== '未命名群聊' ? conv.name : `群 ${String(conv.targetId).slice(0, 8)}`,
      };
      try {
        const state = await getGroupBotState(conv.targetId);
        results.push({
          ...item,
          ok: true,
          memberRole: state.member_role || '',
          recvMsgSetting: state.recv_msg_setting || '',
          allowProactiveMsg: state.allow_proactive_msg === true,
          joinedAt: state.joined_at || '',
        });
      } catch (err) {
        const whitelistOnly = /11253/.test(err.message);
        results.push({
          ...item,
          ok: false,
          error: whitelistOnly
            ? '该接口仅白名单机器人可用（错误码 11253），需要向平台运营申请权限后才能读取'
            : err.message,
        });
      }
    }
    ok(res, { groups: results });
  } catch (err) {
    fail(res, err);
  }
});

/** 生成频道接口权限授权链接（官方唯一支持的「开权限」方式） */
app.post('/api/platform/channel-authorize', async (req, res) => {
  try {
    const guildId = String(req.body?.guildId || '').trim();
    if (!guildId) throw new Error('请填写频道 ID（guild_id）');
    const result = await demandChannelApiPermission(guildId);
    const url = result?.url || result?.data?.url || '';
    hub.log('info', 'platform', `已生成频道 ${guildId} 的接口权限授权链接`);
    ok(res, { url, raw: result });
  } catch (err) {
    fail(res, err);
  }
});

/** 读取机器人在频道内可用的接口权限（含授权状态） */
app.get('/api/platform/channel-permission', async (req, res) => {
  try {
    const guildId = String(req.query.guildId || '').trim();
    if (!guildId) throw new Error('请填写频道 ID（guild_id）');
    ok(res, await getGuildApiPermission(guildId));
  } catch (err) {
    fail(res, err);
  }
});

/* ------------------------------------------------------- 网关事件接线 */

gateway.on('event', async (event) => {
  if (event.type === 'INTERACTION_CREATE') {
    hub.log('info', 'bot', `收到按钮交互（type=${event.data?.type}）`);
    try {
      await fetch(`${apiBase()}/interactions/${encodeURIComponent(event.data.id || event.eventId)}`, {
        method: 'PUT',
        headers: {
          authorization: `QQBot ${await getToken()}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ code: 0 }),
      });
    } catch (err) {
      hub.log('warn', 'bot', `回应按钮交互失败：${err.message}`);
    }
    return;
  }

  const handled = [
    'C2C_MESSAGE_CREATE',
    'GROUP_AT_MESSAGE_CREATE',
    'GROUP_MESSAGE_CREATE',
    'AT_MESSAGE_CREATE',
    'DIRECT_MESSAGE_CREATE',
  ];
  if (!handled.includes(event.type)) {
    hub.log('info', 'gateway', `收到未处理事件 ${event.type}`, { quiet: true });
    return;
  }

  try {
    await handleMessage(event);
  } catch (err) {
    hub.log('error', 'bot', `处理消息失败：${err.message}`);
  }
});

gateway.on('status', () => {
  hub.broadcast('stats', stats());
});

/* ------------------------------------------------------------ 兜底路由 */

app.use('/api', (req, res) => {
  res.status(404).json({ error: `接口不存在：${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  hub.log('error', 'http', `${req.method} ${req.originalUrl} → ${err.message}`);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

/* ---------------------------------------------------------------- 启动 */

/* 启动前重建单文件版控制台；没装 esbuild（例如 --production 安装、或打包进只读的桌面外壳）
   就跳过，此时会自动回落到模块化的 public/index.html。 */
let singleFileState = '';

async function prepareConsole({ build = true } = {}) {
  if (build) {
    try {
      const { buildConsole, isStale } = await import('../build.mjs');
      if (isStale()) await buildConsole({ quiet: true });
    } catch (err) {
      hub.log('warn', 'console', `未能生成单文件版控制台，改用模块化页面：${err.message}`);
    }
  }
  singleFileState = fs.existsSync(SINGLE_FILE) ? '单文件版 console.html' : '';
  if (!singleFileState) singleFileState = '模块化页面 index.html';
  return singleFileState;
}

const LOOPBACKS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * 启动控制台服务。
 *
 * 独立运行时（npm start）底部会自动调用；桌面外壳（Electron）可以导入本模块后自行调用，
 * 这样同一份后端既能当命令行服务跑，也能被嵌进窗口里。
 *
 * @param {object} opts
 *   host  监听地址，默认 127.0.0.1。控制台没有登录鉴权，别随便改成 0.0.0.0
 *   port  监听端口，传 0 让系统分配空闲端口（桌面版就是这么用的）
 *   build 是否在启动前重建单文件版页面；打包后的只读环境应传 false
 * @returns {Promise<{server: import('node:http').Server, port: number, host: string, url: string}>}
 */
export async function startServer({
  host = process.env.QQBOT_HOST || '127.0.0.1',
  port = Number(process.env.PORT ?? DEFAULT_PORT),
  build = true,
  quiet = false,
} = {}) {
  await prepareConsole({ build });

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.once('error', reject);
  });
  server.on('error', () => {}); // 监听成功后再出错由下面的兜底处理

  const actualPort = server.address().port;
  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = `http://${shown}:${actualPort}`;
  const isLoopback = LOOPBACKS.has(host);

  if (!quiet) {
    console.log('');
    console.log('  QQ 机器人控制台已启动');
    console.log(`  控制台地址  ${url}`);
    console.log(`  监听地址    ${host}${isLoopback ? '（仅本机可访问）' : '  ⚠ 已暴露到网络，且控制台没有登录鉴权'}`);
    console.log(`  API 域名    ${apiBase()}`);
    console.log(`  数据目录    ${DATA_DIR}`);
    console.log(`  页面来源    ${singleFileState}`);
    console.log('');
  }
  hub.log('ok', 'console', `控制台已就绪，监听 ${host}:${actualPort}`);
  if (!isLoopback) {
    hub.log('warn', 'console', `控制台正监听在 ${host}，局域网内任何人都能打开它并读取凭据。确认这是你要的。`);
  }

  hub.attach(server);

  /* 旧版本的日志里没有会话档案，启动时补一次，历史记录才能在「消息日志」里按会话浏览 */
  try {
    const filled = backfillFromLogs();
    if (filled.conversations || filled.identities) {
      hub.log('info', 'console', `已根据历史日志补建 ${filled.conversations} 个会话、${filled.identities} 个身份档案`);
    }
  } catch (err) {
    hub.log('warn', 'console', `补建会话档案失败：${err.message}`);
  }

  hub.broadcast('stats', stats());

  const statsTimer = setInterval(() => hub.broadcast('stats', stats()), 15000);
  statsTimer.unref?.();

  /* 启动时自动连接（若已配置并开启自动连接） */
  const bootCfg = config.get();
  if (bootCfg.autoConnect && bootCfg.appId && bootCfg.appSecret) {
    const autoTimer = setTimeout(() => {
      hub.log('info', 'gateway', '自动连接已开启，正在启动机器人…');
      gateway.start().catch((err) => hub.log('error', 'gateway', err.message));
    }, 800);
    autoTimer.unref?.();
  }

  return { server, port: actualPort, host, url };
}

/** 友好地解释端口占用，桌面外壳与命令行都会用到 */
export function explainListenError(err, port) {
  if (err?.code !== 'EADDRINUSE') return err;
  console.error('');
  console.error(`  端口 ${port} 已被占用。`);
  console.error('  如果控制台其实已经在运行，直接打开下面的地址即可：');
  console.error(`      http://127.0.0.1:${port}`);
  console.error('  想换一个端口，可以这样启动：');
  console.error(`      set PORT=3300 && npm start`);
  console.error('');
  return err;
}

/* 未捕获异常兜底，避免控制台静默退出 */
process.on('unhandledRejection', (err) => {
  hub.log('error', 'process', `未处理的 Promise 拒绝：${err?.message || err}`);
});
process.on('uncaughtException', (err) => {
  hub.log('error', 'process', `未捕获异常：${err?.message || err}`);
  console.error(err);
});

/* 直接运行（npm start / node server/index.js）时才自动起服务；
   被桌面外壳 import 时由外壳自己决定何时启动。 */
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    await startServer();
  } catch (err) {
    explainListenError(err, Number(process.env.PORT ?? 3200));
    process.exit(1);
  }
}
