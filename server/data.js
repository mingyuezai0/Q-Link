import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, BOTS_DIR } from './paths.js';
import { Doc, Collection } from './store.js';

export const uid = () => randomUUID().replace(/-/g, '').slice(0, 12);

/* ==========================================================================
   机器人档案（data/bots.json）
   每个机器人拥有完全独立的一套配置：登录凭据、人设、记忆、词库、名单、会话、日志。
   ========================================================================== */

const BOTS_FILE = path.join(DATA_DIR, 'bots.json');

const botsDoc = new Doc(BOTS_FILE, { activeId: '', order: [], meta: {} });

/** 旧版是单机器人布局（data/config.json 等直接放在 data/ 下），这里做一次迁移 */
const LEGACY_FILES = [
  'config.json',
  'persona.json',
  'memories.json',
  'keywords.json',
  'banned.json',
  'stickers.json',
  'memes.json',
  'sessions.json',
  'logs.json',
];

function readJsonSafe(file) {
  try {
    // 有些编辑器（以及 Windows 上的 PowerShell 5.1）会给 UTF-8 文件加 BOM，
    // JSON.parse 遇到 BOM 会直接抛错，这里先剥掉。
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ensureBots() {
  const state = botsDoc.get();
  if (state.order.length) return;

  const id = 'default';
  const dir = path.join(BOTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  // 迁移旧的单机器人数据
  let legacyPersona = null;
  let legacyConfig = null;
  for (const name of LEGACY_FILES) {
    const from = path.join(DATA_DIR, name);
    if (!fs.existsSync(from)) continue;
    if (name === 'persona.json') legacyPersona = readJsonSafe(from);
    if (name === 'config.json') legacyConfig = readJsonSafe(from);
    fs.renameSync(from, path.join(dir, name));
  }

  const state2 = botsDoc.get();
  state2.activeId = id;
  state2.order = [id];
  state2.meta = {
    [id]: {
      id,
      name: legacyPersona?.name || '我的机器人',
      avatar: legacyPersona?.avatar || '',
      appId: legacyConfig?.appId || '',
      source: legacyConfig?.appId ? 'manual' : '',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    },
  };
  botsDoc.persist();
}

ensureBots();

/* ==========================================================================
   老数据迁移：语气/长度/表情等从「枚举档位」改成「0~100 滑杆」
   ========================================================================== */

const LEGACY_TONE = { cool: 10, calm: 20, professional: 32, friendly: 55, lively: 82 };
const LEGACY_LENGTH = { short: 20, medium: 55, long: 90 };
const LEGACY_EMOJI_LEVEL = { 0: 0, 1: 30, 2: 62, 3: 90 };
const LEGACY_ATTITUDE = { ignore: 5, cold: 30, normal: 50, warm: 80 };

const PERSONA_SLIDER_DEFAULTS = { tone: 55, replyLength: 55, emojiLevel: 60, humor: 50, initiative: 45, formality: 35 };

/**
 * 把任意历史写法折算成 0~100 的数值。
 * preferLegacy 为 true 时必须先查旧映射表：旧的表情档位 0/1/2/3 本身就是数字，
 * 光看 typeof 会把它当成新滑杆值（1 分）而不是旧档位（1 档 = 30 分）。
 */
function toSlider(value, legacyMap, fallback, preferLegacy = false) {
  if (preferLegacy && value !== undefined && value !== null && legacyMap[value] !== undefined) {
    return legacyMap[value];
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(100, Math.max(0, Math.round(value)));
  if (value !== undefined && value !== null && legacyMap[value] !== undefined) return legacyMap[value];
  return fallback;
}

/** 归一化人设；返回是否发生了改动 */
export function normalizePersona(p) {
  let changed = false;
  const out = { ...p };
  const preferLegacy = out.schema !== 2;
  if (preferLegacy) {
    changed = true;
    out.schema = 2;
  }
  for (const [key, fallback] of Object.entries(PERSONA_SLIDER_DEFAULTS)) {
    const legacy = key === 'tone' ? LEGACY_TONE : key === 'replyLength' ? LEGACY_LENGTH : key === 'emojiLevel' ? LEGACY_EMOJI_LEVEL : {};
    const next = toSlider(out[key], legacy, fallback, preferLegacy);
    if (out[key] !== next) {
      out[key] = next;
      changed = true;
    }
  }
  return { persona: out, changed };
}

/** 归一化名单里的人：mode 枚举 → attitude 滑杆 */
export function normalizePerson(p) {
  let changed = false;
  const out = { ...p };
  if (typeof out.attitude !== 'number') {
    out.attitude = LEGACY_ATTITUDE[out.mode] ?? (out.listTag === 'blacklist' ? 5 : 80);
    changed = true;
  }
  const mode = attitudeToMode(out.attitude);
  if (out.mode !== mode) {
    out.mode = mode; // 保留 mode 字段，规则层与旧数据都能用
    changed = true;
  }
  return { person: out, changed };
}

/** 态度滑杆 → 行为档位 */
export function attitudeToMode(attitude) {
  const v = Number(attitude);
  if (!Number.isFinite(v)) return 'normal';
  if (v <= 15) return 'ignore';
  if (v <= 39) return 'cold';
  if (v <= 60) return 'normal';
  if (v <= 85) return 'warm';
  return 'devoted';
}

/**
 * 启动时把所有机器人的老数据迁移一遍。
 * 逐个机器人处理，处理完写回磁盘，之后运行时就可以当数值用。
 */
function migrateAllBots() {
  const state = botsDoc.get();
  let migrated = 0;
  for (const id of state.order) {
    const dir = path.join(BOTS_DIR, id);

    const personaFile = path.join(dir, 'persona.json');
    const raw = readJsonSafe(personaFile);
    if (raw) {
      const { persona: next, changed } = normalizePersona(raw);
      if (changed) {
        fs.writeFileSync(personaFile, JSON.stringify(next, null, 2), 'utf8');
        migrated += 1;
      }
    }

    const peopleFile = path.join(dir, 'people.json');
    const list = readJsonSafe(peopleFile);
    if (Array.isArray(list)) {
      let touched = false;
      const next = list.map((p) => {
        const r = normalizePerson(p);
        if (r.changed) touched = true;
        return r.person;
      });
      if (touched) {
        fs.writeFileSync(peopleFile, JSON.stringify(next, null, 2), 'utf8');
        migrated += 1;
      }
    }
  }
  return migrated;
}

migrateAllBots();

/* ------------------------------------------------------------- 机器人操作 */

export function activeBotId() {
  const state = botsDoc.get();
  if (!state.order.includes(state.activeId)) {
    state.activeId = state.order[0] || '';
    botsDoc.persist();
  }
  return state.activeId;
}

export function activeBot() {
  const id = activeBotId();
  const meta = botsDoc.get().meta[id];
  if (!meta) throw new Error('当前没有可用的机器人');
  return meta;
}

export function listBots() {
  const state = botsDoc.get();
  const active = activeBotId();
  return state.order
    .map((id) => state.meta[id])
    .filter(Boolean)
    .map((meta) => ({
      ...meta,
      active: meta.id === active,
      // 只回显前 4 位，避免侧边栏把完整 AppID 显示出来
      appIdHint: meta.appId ? `${String(meta.appId).slice(0, 4)}…` : '',
    }));
}

export function createBot({ name = '新机器人', source = 'manual', appId = '' } = {}) {
  const id = uid();
  fs.mkdirSync(path.join(BOTS_DIR, id), { recursive: true });
  const state = botsDoc.get();
  state.order.push(id);
  state.meta[id] = {
    id,
    name: String(name).slice(0, 40),
    avatar: '',
    appId: String(appId || ''),
    source,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  botsDoc.persist();
  return state.meta[id];
}

export function updateBotProfile(id, patch = {}) {
  const state = botsDoc.get();
  const meta = state.meta[id];
  if (!meta) throw new Error('机器人不存在');
  if (patch.name !== undefined) meta.name = String(patch.name).slice(0, 40) || meta.name;
  if (patch.avatar !== undefined) meta.avatar = String(patch.avatar || '');
  if (patch.appId !== undefined) meta.appId = String(patch.appId || '');
  if (patch.source !== undefined) meta.source = String(patch.source || '');
  state.meta[id] = meta;
  botsDoc.persist();
  return meta;
}

export function activateBot(id) {
  const state = botsDoc.get();
  if (!state.meta[id]) throw new Error('机器人不存在');
  state.activeId = id;
  state.meta[id].lastUsedAt = Date.now();
  botsDoc.persist();
  stores.get(id)?.reload();
  return state.meta[id];
}

export function deleteBot(id) {
  const state = botsDoc.get();
  if (!state.meta[id]) throw new Error('机器人不存在');
  if (state.order.length <= 1) throw new Error('至少要保留一个机器人');
  state.order = state.order.filter((x) => x !== id);
  delete state.meta[id];
  if (state.activeId === id) state.activeId = state.order[0];
  botsDoc.persist();
  stores.delete(id);
  try {
    fs.rmSync(path.join(BOTS_DIR, id), { recursive: true, force: true });
  } catch {
    /* 目录删不掉不影响使用 */
  }
  return state.meta[state.activeId];
}

/* ==========================================================================
   按机器人隔离的文档与集合
   ========================================================================== */

class BotStore {
  constructor(id) {
    this.id = id;
    this.dir = path.join(BOTS_DIR, id);
    this.docs = new Map();
    this.colls = new Map();
  }

  doc(name, defaults) {
    if (!this.docs.has(name)) this.docs.set(name, new Doc(path.join(this.dir, name), defaults));
    return this.docs.get(name);
  }

  coll(name) {
    if (!this.colls.has(name)) this.colls.set(name, new Collection(path.join(this.dir, name), []));
    return this.colls.get(name);
  }

  /** 外部直接改过磁盘文件时（导入）重新加载 */
  reload() {
    for (const doc of this.docs.values()) doc.load();
    for (const coll of this.colls.values()) coll.load();
  }
}

const stores = new Map();

function storeFor(id = activeBotId()) {
  if (!id) throw new Error('当前没有可用的机器人');
  if (!stores.has(id)) stores.set(id, new BotStore(id));
  return stores.get(id);
}

const current = () => storeFor();

/* --------------------------------------------------------------- 门面对象 */

/** 让调用方继续用 config.get() / config.patch() 这样的写法，但实际落在"当前机器人"上 */
function docFacade(name, defaults) {
  const target = () => current().doc(name, defaults);
  return {
    get: () => target().get(),
    patch: (patch) => target().patch(patch),
    replace: (value) => target().replace(value),
    persist: () => target().persist(),
  };
}

function collFacade(name) {
  const target = () => current().coll(name);
  return {
    list: () => target().list(),
    find: (id) => target().find(id),
    add: (item) => target().add(item),
    update: (id, patch) => target().update(id, patch),
    remove: (id) => target().remove(id),
    replaceAll: (items) => target().replaceAll(items),
    persist: () => target().persist(),
  };
}

/** 当前机器人目录，供需要落盘文件的代码使用 */
export function activeBotDir() {
  return current().dir;
}

/* ==========================================================================
   各模块默认值
   ========================================================================== */

/**
 * 事件订阅位（intents），数值来自官方文档「事件订阅 intents」。
 * 注意：单聊消息、群 @ 消息、群全量消息共用 GROUP_AND_C2C_EVENT 这一位。
 */
export const DEFAULT_INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C_EVENT: 1 << 25, // 单聊 + 群聊（含 @ 与全量）
  INTERACTION: 1 << 26, // 按钮 / 快捷菜单交互
  MESSAGE_AUDIT: 1 << 27,
  PUBLIC_GUILD_MESSAGES: 1 << 30, // 频道 @ 消息
};

export const config = docFacade('config.json', {
  appId: '',
  appSecret: '',
  sandbox: false,
  baseUrl: '', // 留空使用官方默认域名
  mode: 'websocket',
  intents: DEFAULT_INTENTS.GROUP_AND_C2C_EVENT | DEFAULT_INTENTS.INTERACTION,
  autoConnect: false,
  autoStartAfterBind: true, // 扫码绑定成功后自动启动
  ai: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.8,
    maxTokens: 1024,
    historyRounds: 8,
    timeoutMs: 60000,
  },
  reply: {
    privateEnabled: true,
    groupEnabled: true,
    channelEnabled: false, // 频道回复尚未实现，这里只记录开关状态
    groupRequireMention: true,
    maxLength: 900,
    quoteReply: true,
    errorNotice: true,
  },
  /**
   * 平台侧权限开关的本地记录。
   *
   * 说明：这几项在 QQ 开放平台管理端配置。官方 OpenAPI 里没有读写它们的接口
   * （「用户/机器人」分类下只有只读的 GET /users/@me 与 GET /users/@me/guilds），
   * 所以这里只能存本机的意图，并从平台读取能读到的部分做对照，无法真正回写。
   */
  platform: {
    groupAdmin: false,
    discoverable: false,
    lastSyncedAt: 0,
    lastPlatformSnapshot: null,
  },
  features: {
    banned: true,
    keywords: true,
    memes: true,
    memory: true,
    stickers: true,
    lists: true, // 白名单 / 黑名单
    autoMemory: true,
    autoMemoryEvery: 8,
    logMessages: true,
  },
  lists: {
    whitelistMode: 'warm', // warm=更熟络热情 / normal=照常
    blacklistMode: 'ignore', // ignore=完全不回复 / cold=冷淡简短
    blacklistCooldown: 300, // cold 模式下的最小回复间隔（秒）
  },
  updatedAt: Date.now(),
});

export const persona = docFacade('persona.json', {
  schema: 2, // 2 = 语气/长度/表情等改用 0~100 滑杆；1 = 旧的枚举与档位
  name: '小Q',
  avatar: '',
  identity: '住在 QQ 里的 AI 伙伴',
  system: [
    '你是「小Q」，一个住在 QQ 里的 AI 伙伴。',
    '你说话自然、简短、有温度，像朋友聊天，而不是念稿子。',
    '你不使用 Markdown 标题和加粗，避免长篇大论，除非对方明确要求详细解释。',
    '你不知道的事就坦白说不确定，绝不编造事实。',
  ].join('\n'),
  /** 0 安静克制 ←→ 100 活跃活泼 */
  tone: 55,
  /** 0 简短 ←→ 100 详尽 */
  replyLength: 55,
  /** 0 不用 ←→ 100 常用 */
  emojiLevel: 60,
  /** 0 严肃 ←→ 100 幽默 */
  humor: 50,
  /** 0 被动回应 ←→ 100 主动找话题 */
  initiative: 45,
  /** 0 随意口语 ←→ 100 正式得体 */
  formality: 35,
  style: '口语化短句，偶尔用语气词，不用客服腔',
  greeting: '你好呀，我是小Q 👋 有什么想聊的？',
  rules: ['称呼用户时用「你」，不用「您」以外的敬语堆砌', '不主动索要隐私信息'],
  taboo: '政治敏感、违法违规、色情低俗、诱导站外交易的内容一律不接话，礼貌转移话题',
  signature: '',
  updatedAt: Date.now(),
});

export const memories = collFacade('memories.json');
export const keywords = collFacade('keywords.json');
export const bannedWords = collFacade('banned.json');
export const stickers = collFacade('stickers.json');
export const memes = collFacade('memes.json');

/**
 * 白名单 / 黑名单里的人。
 *
 * 为什么一个人要存多个 openid：官方接口不返回 QQ 号，只能靠 openid 认人，而
 * user_openid（单聊）与 member_openid（群聊）是两套互不通用的标识，且 member_openid
 * 还是按群区分的。所以同一个真人在这台机器人下会有一组 openid，这里把它们绑到同一个人身上。
 * 好处是用户改昵称、改头像都不会影响识别，比用 QQ 号更稳。
 */
export const people = collFacade('people.json');

/** 会话上下文：{ [peerId]: { messages, lastAt, autoMemoryAt } } */
export const sessions = docFacade('sessions.json', {});

/** 会话档案：{ [conversationId]: { scope, targetId, name, members, counts, lastAt } } */
export const conversations = docFacade('conversations.json', {});

/** 见过的用户：{ [openid]: { openid, scope, name, names, groupId, count, firstAt, lastAt } } */
export const identities = docFacade('identities.json', {});

export const logs = collFacade('logs.json');

export const MAX_LOGS = 600;

export function pushLog(entry) {
  logs.add({ id: uid(), at: Date.now(), ...entry });
  if (logs.list().length > MAX_LOGS) {
    logs.replaceAll(logs.list().slice(0, MAX_LOGS));
  }
}

/* ==========================================================================
   会话上下文
   ========================================================================== */

export const MAX_SESSION_MESSAGES = 40;

export function getSession(peerId) {
  const all = sessions.get();
  if (!all[peerId]) {
    all[peerId] = { messages: [], lastAt: 0, autoMemoryAt: 0 };
    sessions.persist();
  }
  return all[peerId];
}

export function appendSession(peerId, role, content) {
  const all = sessions.get();
  const s = getSession(peerId);
  s.messages.push({ role, content, at: Date.now() });
  if (s.messages.length > MAX_SESSION_MESSAGES) s.messages = s.messages.slice(-MAX_SESSION_MESSAGES);
  s.lastAt = Date.now();
  all[peerId] = s;
  sessions.persist();
}

export function resetSession(peerId) {
  const all = sessions.get();
  all[peerId] = { messages: [], lastAt: Date.now(), autoMemoryAt: 0 };
  sessions.persist();
}

/* ==========================================================================
   会话档案 & 身份档案（供"消息日志"按私聊/群聊浏览）
   ========================================================================== */

export function conversationIdOf(scope, targetId) {
  return `${scope}:${targetId}`;
}

/**
 * 记一次会话活动。
 * scope='c2c' 时 targetId 是用户 openid；scope='group' 时 targetId 是群 openid。
 */
export function touchConversation({ scope, targetId, peerKey, userName, direction, text, at = Date.now() }) {
  if (!targetId) return;
  const all = conversations.get();
  const cid = conversationIdOf(scope, targetId);
  const conv = all[cid] || {
    id: cid,
    scope,
    targetId,
    name: scope === 'group' ? '未命名群聊' : '私聊',
    members: {},
    counts: { in: 0, out: 0 },
    firstAt: at,
    lastAt: at,
  };

  conv.lastAt = at;
  conv.counts[direction] = (conv.counts[direction] || 0) + 1;
  conv.lastText = String(text || '').slice(0, 120);

  // 群聊里按成员登记，私聊只有一个成员（就是对方）
  if (peerKey) {
    const member = conv.members[peerKey] || { key: peerKey, name: userName || '', count: 0, firstAt: at, lastAt: at };
    member.count += 1;
    member.lastAt = at;
    if (userName) member.name = userName;
    conv.members[peerKey] = member;
  }

  all[cid] = conv;
  conversations.persist();
  return conv;
}

/** 记录见过的用户身份，用于名单页挑选与日志展示 */
export function touchIdentity({ openid, scope, name, groupId, at = Date.now() }) {
  if (!openid) return null;
  const all = identities.get();
  const item = all[openid] || {
    openid,
    scopes: [],
    names: [],
    groups: [],
    count: 0,
    firstAt: at,
    lastAt: at,
  };
  item.count += 1;
  item.lastAt = at;
  item.scope = scope;
  if (!item.scopes.includes(scope)) item.scopes.push(scope);
  if (name && !item.names.includes(name)) item.names = [name, ...item.names].slice(0, 5);
  item.name = name || item.name || '';
  if (groupId && !item.groups.includes(groupId)) item.groups = [groupId, ...item.groups].slice(0, 10);
  if (groupId) item.groupId = groupId;
  all[openid] = item;
  identities.persist();
  return item;
}

export function setConversationName(cid, name) {
  const all = conversations.get();
  if (!all[cid]) return null;
  all[cid].name = String(name || '').slice(0, 40);
  conversations.persist();
  return all[cid];
}

/**
 * 用已有的日志补建会话档案与身份档案。
 *
 * 从旧版本升级上来时，日志里有历史消息但还没有会话档案，
 * 不补的话「消息日志」页会显示成"还没有对话"。
 * 只补缺失的，重复调用无副作用。
 */
export function backfillFromLogs() {
  const convs = conversations.get();
  const idents = identities.get();
  let convChanged = false;
  let identChanged = false;

  // logs 是「新的在前」，补建时从旧到新处理，lastAt 才正确
  const entries = [...logs.list()].reverse();

  for (const entry of entries) {
    if (!entry?.scope || !entry.targetId) continue;
    const at = entry.at || Date.now();
    const direction = entry.kind === 'out' || entry.kind === 'keyword' ? 'out' : 'in';

    const cid = conversationIdOf(entry.scope, entry.targetId);
    const memberKey =
      entry.scope === 'group' ? String(entry.peerId || '').split(':').slice(1).join(':') : String(entry.peerId || '');

    if (!convs[cid]) {
      convs[cid] = {
        id: cid,
        scope: entry.scope,
        targetId: entry.targetId,
        name: entry.scope === 'group' ? '未命名群聊' : '私聊',
        members: {},
        counts: { in: 0, out: 0 },
        firstAt: at,
        lastAt: at,
      };
      convChanged = true;
    }
    const conv = convs[cid];
    const prevLastAt = conv.lastAt || 0;
    conv.lastAt = at;
    conv.counts[direction] = (conv.counts[direction] || 0) + 1;
    if (!conv.lastText || at >= prevLastAt) conv.lastText = String(entry.text || '').slice(0, 120);

    if (memberKey) {
      const member = conv.members[memberKey] || {
        key: memberKey,
        name: entry.userName || '',
        count: 0,
        firstAt: at,
        lastAt: at,
      };
      member.count += 1;
      member.lastAt = at;
      if (entry.userName) member.name = entry.userName;
      conv.members[memberKey] = member;
      convChanged = true;

      const ident = idents[memberKey] || {
        openid: memberKey,
        scopes: [],
        names: [],
        groups: [],
        count: 0,
        firstAt: at,
        lastAt: at,
      };
      ident.count += 1;
      ident.lastAt = at;
      ident.scope = entry.scope;
      if (!ident.scopes.includes(entry.scope)) ident.scopes.push(entry.scope);
      if (entry.userName && !ident.names.includes(entry.userName)) ident.names = [entry.userName, ...ident.names].slice(0, 5);
      if (entry.userName) ident.name = entry.userName;
      if (entry.groupId && !ident.groups.includes(entry.groupId)) ident.groups = [entry.groupId, ...ident.groups].slice(0, 10);
      if (entry.groupId) ident.groupId = entry.groupId;
      idents[memberKey] = ident;
      identChanged = true;
    }
  }

  if (convChanged) conversations.persist();
  if (identChanged) identities.persist();
  return { conversations: Object.keys(convs).length, identities: Object.keys(idents).length };
}

/* ==========================================================================
   统计
   ========================================================================== */

export function stats() {
  const all = people.list();
  return {
    messages: logs.list().length,
    memories: memories.list().length,
    keywords: keywords.list().length,
    banned: bannedWords.list().length,
    stickers: stickers.list().length,
    memes: memes.list().length,
    whitelist: all.filter((p) => p.listTag === 'whitelist').length,
    blacklist: all.filter((p) => p.listTag === 'blacklist').length,
    conversations: Object.keys(conversations.get()).length,
    identities: Object.keys(identities.get()).length,
    peers: Object.keys(sessions.get()).length,
  };
}

/* ==========================================================================
   名单里的人
   ========================================================================== */

/** 把一个人身上绑定的所有 openid 摊平，交给规则层做匹配 */
export function personOpenids(person) {
  return (person?.openids || []).map((o) => String(o.openid)).filter(Boolean);
}

/** 找出某个 openid 归属的人（可能已被拉白或拉黑） */
export function findPersonByOpenid(openid) {
  if (!openid) return null;
  const hit = people.list().find((p) => p.enabled !== false && personOpenids(p).includes(String(openid))) || null;
  // 防御性归一化：即使有人手改了 people.json，规则层拿到的 mode 也是对的
  return hit ? normalizePerson(hit).person : null;
}

/** 新观察到的 openid 绑定到某个人；已绑过就更新昵称与统计 */
export function bindOpenid(personId, { openid, scope, groupId, name }) {
  const person = people.find(personId);
  if (!person) throw new Error('这位用户不存在');
  const list = Array.isArray(person.openids) ? [...person.openids] : [];
  const idx = list.findIndex((o) => String(o.openid) === String(openid));
  const now = Date.now();
  if (idx >= 0) {
    list[idx] = { ...list[idx], name: name || list[idx].name, lastAt: now, count: (list[idx].count || 0) + 1 };
  } else {
    list.push({ openid: String(openid), scope: scope || '', groupId: groupId || '', name: name || '', count: 1, firstAt: now, lastAt: now });
  }
  return people.update(personId, { openids: list });
}

export function unbindOpenid(personId, openid) {
  const person = people.find(personId);
  if (!person) throw new Error('这位用户不存在');
  return people.update(personId, {
    openids: (person.openids || []).filter((o) => String(o.openid) !== String(openid)),
  });
}
