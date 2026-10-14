import { config } from '../data.js';
import { hub } from '../hub.js';

/**
 * QQ 开放平台 OpenAPI 客户端
 * 文档依据：https://bot.q.qq.com/wiki/develop/api-v2/
 *  - 统一域名 api.bot.qq.com
 *  - 鉴权头 Authorization: QQBot {access_token}
 *  - access_token 有效期 7200 秒，过期前 60 秒内可取到新 token
 */

const DEFAULT_BASE = 'https://api.bot.qq.com';
const SANDBOX_BASE = 'https://sandbox.api.sgroup.qq.com';

let cache = { token: '', expiresAt: 0, key: '' };

export function apiBase() {
  const cfg = config.get();
  if (cfg.baseUrl && cfg.baseUrl.trim()) return cfg.baseUrl.trim().replace(/\/+$/, '');
  return cfg.sandbox ? SANDBOX_BASE : DEFAULT_BASE;
}

export function clearToken() {
  cache = { token: '', expiresAt: 0, key: '' };
}

/** 取 access_token（带缓存与提前刷新） */
export async function getToken({ force = false } = {}) {
  const cfg = config.get();
  const appId = (cfg.appId || '').trim();
  const secret = (cfg.appSecret || '').trim();
  if (!appId || !secret) throw new Error('尚未填写 AppID / AppSecret');

  const key = `${appId}:${secret.length}:${apiBase()}`;
  const fresh = cache.token && cache.key === key && Date.now() < cache.expiresAt - 60_000;
  if (fresh && !force) return cache.token;

  const res = await fetch(`${apiBase()}/app/getAppAccessToken`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret: secret }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`获取 access_token 失败：返回内容无法解析（HTTP ${res.status}）`);
  }

  // 注意：该接口失败时 HTTP 仍返回 200，需依据 code 判断
  if (json.code && json.code !== 0) {
    throw new Error(`获取 access_token 失败：${json.message || json.code}（错误码 ${json.code}）`);
  }
  if (!json.access_token) {
    throw new Error(`获取 access_token 失败：${json.message || '响应中没有 access_token'}`);
  }

  const expiresIn = Number(json.expires_in) || 7200;
  cache = { token: json.access_token, expiresAt: Date.now() + expiresIn * 1000, key };
  hub.log('ok', 'auth', `已获取 access_token，有效期 ${expiresIn} 秒`);
  return cache.token;
}

/** 统一请求封装：401 时自动强制刷新一次 token 重试 */
export async function request(method, path, { body, query, retry = true, timeoutMs = 15000 } = {}) {
  const token = await getToken();
  const url = new URL(apiBase() + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `QQBot ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401 && retry) {
      clearToken();
      await getToken({ force: true });
      return request(method, path, { body, query, retry: false, timeoutMs });
    }

    if (res.status === 204) return {};

    const text = await res.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }

    if (!res.ok) {
      const errCode = json.err_code ?? json.code;
      const message = json.message || res.statusText;
      throw new Error(`QQ 接口错误 ${res.status}${errCode ? ` / ${errCode}` : ''}：${message}`);
    }
    if (json.err_code) {
      throw new Error(`QQ 接口错误 ${json.err_code}：${json.message || ''}`);
    }
    return json;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('QQ 接口请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ 网关 */

export async function getGateway() {
  return request('GET', '/gateway');
}

export async function getMe() {
  return request('GET', '/users/@me');
}

/* ------------------------------------------------------------------ 发消息 */

/**
 * 发送单聊消息。
 * @param {string} userOpenid
 * @param {object} payload { content, msgType, msgId, msgSeq, media, keyboard, messageReference }
 */
export async function sendC2C(userOpenid, payload) {
  return sendMessage(`/v2/users/${encodeURIComponent(userOpenid)}/messages`, payload);
}

/** 发送群聊消息（groupOpenid 同样放在 path 上） */
export async function sendGroup(groupOpenid, payload) {
  return sendMessage(`/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, payload);
}

async function sendMessage(path, { content, msgType = 0, msgId, msgSeq = 1, media, keyboard, messageReference, markdown }) {
  const body = { msg_type: msgType };
  if (msgType === 7) {
    body.media = media;
  } else if (msgType === 2) {
    body.markdown = markdown || { content };
  } else {
    body.content = content ?? '';
  }
  if (msgId) body.msg_id = msgId;
  if (msgSeq) body.msg_seq = msgSeq;
  if (keyboard) body.keyboard = keyboard;
  if (messageReference) body.message_reference = messageReference;

  return request('POST', path, { body });
}

/** 发送「输入中」状态（仅单聊，msg_type=6） */
export async function sendTyping(userOpenid, msgId, msgSeq = 1, seconds = 30) {
  return request('POST', `/v2/users/${encodeURIComponent(userOpenid)}/messages`, {
    body: {
      msg_type: 6,
      input_notify: { input_type: 1, input_second: Math.min(seconds, 60) },
      msg_id: msgId,
      msg_seq: msgSeq,
    },
  });
}

/* ------------------------------------------------------------------ 富媒体 */

export function fileTypeOf(mime = '') {
  if (/^image\/(png|jpe?g)/i.test(mime)) return 1;
  if (/^video\/mp4/i.test(mime)) return 2;
  if (/^audio\//i.test(mime)) return 3;
  return 4;
}

/**
 * 上传富媒体，拿到可复用的 file_info。
 * scope: 'c2c' → /v2/users/{id}/files；'group' → /v2/groups/{id}/files
 * 支持 url 直传或 file_data（base64，≤5MB）。
 */
export async function uploadMedia(scope, openid, options = {}) {
  const segment = scope === 'group' ? 'groups' : 'users';
  const { fileType = 1, url, fileData, fileName = 'file', srvSendMsg = false } = options;
  const body = { file_type: fileType, srv_send_msg: srvSendMsg };
  if (url) body.url = url;
  if (fileData) {
    body.file_data = fileData;
    body.file_name = fileName;
  }
  const result = await request('POST', `/v2/${segment}/${encodeURIComponent(openid)}/files`, {
    body,
    timeoutMs: 60000,
  });
  if (!result.file_info) throw new Error('上传成功但没有返回 file_info');
  return result;
}

/** 发送已经上传好的富媒体 */
export async function sendMedia(scope, openid, fileInfo, { msgId, msgSeq = 1, messageReference } = {}) {
  const path = scope === 'group'
    ? `/v2/groups/${encodeURIComponent(openid)}/messages`
    : `/v2/users/${encodeURIComponent(openid)}/messages`;
  return sendMessage(path, { msgType: 7, media: { file_info: fileInfo }, msgId, msgSeq, messageReference });
}

/* ------------------------------------------------------- 平台侧权限查询 */

/**
 * 获取机器人在指定群里的真实状态。
 * 返回 recv_msg_setting（群内消息接收范围）、allow_proactive_msg、member_role。
 * 注意：官方文档标注该接口「仅白名单机器人可用」，非白名单会返回 11253。
 */
export async function getGroupBotState(groupOpenid) {
  return request('GET', `/v2/groups/${encodeURIComponent(groupOpenid)}/bot_state`);
}

/** 查询机器人在频道内可用的接口权限列表（含 auth_status 授权状态） */
export async function getGuildApiPermission(guildId) {
  return request('GET', `/guilds/${encodeURIComponent(guildId)}/api_permission`);
}

/**
 * 生成频道接口权限的授权链接 —— 这是官方唯一支持的「开权限」方式，
 * 权限最终由频道主点击链接授权，机器人无法自行开启。
 */
export async function demandChannelApiPermission(guildId) {
  return request('POST', `/guilds/${encodeURIComponent(guildId)}/api_permission/demand`, { body: {} });
}

/* ------------------------------------------------------------------ 撤回 */

export async function recallMessage(scope, openid, messageId) {
  const segment = scope === 'group' ? 'groups' : 'users';
  return request('DELETE', `/v2/${segment}/${encodeURIComponent(openid)}/messages/${encodeURIComponent(messageId)}`);
}

/* ------------------------------------------------------------------ 工具 */

/** 按最大长度切分长文本，避免 40054007 消息长度超限 */
export function splitText(text, max = 900) {
  const source = String(text ?? '').trim();
  if (!source) return [];
  if (source.length <= max) return [source];

  const chunks = [];
  let rest = source;
  while (rest.length > max) {
    let cut = -1;
    for (const mark of ['\n\n', '\n', '。', '！', '？', '；', '. ', '! ', '? ', ' ']) {
      const idx = rest.lastIndexOf(mark, max);
      if (idx > cut) cut = idx + mark.length;
    }
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}
