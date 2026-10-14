import { WebSocket } from 'ws';
import { getGateway, getToken, clearToken } from './api.js';
import { config } from '../data.js';
import { hub } from '../hub.js';

/**
 * QQ 开放平台 WebSocket 网关客户端。
 * 覆盖 op 0/1/2/6/7/9/10/11，支持心跳、断线重连与 Resume 补发。
 * 文档：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/event-emit/websocket.html
 */

const FATAL_CODES = new Set([4001, 4002, 4010, 4011, 4012, 4013, 4014, 4914, 4915]);
const RESUME_CODES = new Set([4008, 4009]);
const IDENTIFY_CODES = new Set([4006, 4007, 4900, 4901, 4902, 4903, 4904, 4905, 4906, 4907, 4908, 4909, 4910, 4911, 4912, 4913]);

class Gateway {
  constructor() {
    this.ws = null;
    this.seq = null;
    this.sessionId = null;
    this.heartbeatTimer = null;
    this.heartbeatInterval = 45000;
    this.acked = true;
    this.state = 'offline';
    this.detail = '未连接';
    this.error = '';
    this.stopping = false;
    this.reconnectTimer = null;
    this.retries = 0;
    this.botUser = null;
    this.listeners = new Map();
    this.connecting = false;
  }

  /* --------------------------------------------------------------- 事件 */

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.listeners.get(event) || []) {
      try {
        handler(payload);
      } catch (err) {
        hub.log('error', 'gateway', `事件处理异常：${err.message}`);
      }
    }
  }

  setState(state, detail, error = '') {
    this.state = state;
    this.detail = detail;
    this.error = error;
    hub.broadcast('status', this.status());
    this.emit('status', this.status());
  }

  status() {
    const cfg = config.get();
    return {
      state: this.state,
      detail: this.detail,
      error: this.error,
      appId: cfg.appId ? `${String(cfg.appId).slice(0, 4)}****` : '',
      sandbox: Boolean(cfg.sandbox),
      bot: this.botUser,
      since: this.startedAt || 0,
    };
  }

  /* --------------------------------------------------------------- 生命周期 */

  async start() {
    if (this.connecting || this.state === 'online' || this.state === 'connecting') {
      return this.status();
    }
    this.stopping = false;
    this.connecting = true;
    this.retries = 0;
    try {
      await this.connect({ resume: false });
    } finally {
      this.connecting = false;
    }
    return this.status();
  }

  stop() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    this.clearHeartbeat();
    if (this.ws) {
      try {
        this.ws.close(1000, 'client stop');
      } catch {
        /* 忽略 */
      }
      this.ws = null;
    }
    this.sessionId = null;
    this.seq = null;
    this.botUser = null;
    this.setState('offline', '未连接');
    hub.log('info', 'gateway', '已断开连接');
  }

  async restart() {
    this.stop();
    await new Promise((r) => setTimeout(r, 300));
    return this.start();
  }

  /* --------------------------------------------------------------- 连接 */

  async connect({ resume = false } = {}) {
    this.setState('connecting', resume ? '正在恢复连接…' : '正在连接网关…');
    clearToken();

    let url;
    try {
      const info = await getGateway();
      url = info.url;
      if (!url) throw new Error('网关地址为空');
    } catch (err) {
      this.setState('error', '获取网关失败', err.message);
      hub.log('error', 'gateway', `获取网关失败：${err.message}`);
      this.scheduleReconnect();
      return;
    }

    const token = await getToken().catch((err) => {
      this.setState('error', '鉴权失败', err.message);
      hub.log('error', 'auth', err.message);
      return null;
    });
    if (!token) return;

    const ws = new WebSocket(url);
    this.ws = ws;
    this.pendingResume = resume && Boolean(this.sessionId);

    ws.on('open', () => {
      hub.log('info', 'gateway', 'WebSocket 已连接，等待 Hello');
    });

    ws.on('message', (raw) => {
      let packet;
      try {
        packet = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handlePacket(packet);
    });

    ws.on('error', (err) => {
      hub.log('warn', 'gateway', `连接异常：${err.message}`);
    });

    ws.on('close', (code, reason) => {
      this.clearHeartbeat();
      if (this.stopping || this.ws !== ws) return;
      const text = reason?.toString() || '';
      hub.log('warn', 'gateway', `连接关闭（${code}${text ? ` ${text}` : ''}）`);
      this.ws = null;
      this.handleCloseCode(code);
    });
  }

  handleCloseCode(code) {
    if (FATAL_CODES.has(code)) {
      const hints = {
        4001: '无效的 opcode',
        4002: '无效的 payload',
        4010: '无效的 shard',
        4011: '需要处理的频道过多，请分片',
        4012: '无效的 version',
        4013: '无效的 intents',
        4014: 'intents 无权限：请到 QQ 开放平台申请对应事件权限，或在「接入配置」里取消勾选',
        4914: '机器人已下架，仅允许连接沙箱环境',
        4915: '机器人已封禁，无法连接',
      };
      const message = hints[code] || `不可恢复的错误 ${code}`;
      this.setState('error', '连接被拒绝', message);
      hub.log('error', 'gateway', `连接被拒绝：${message}`, { quiet: true });
      return;
    }
    if (RESUME_CODES.has(code)) {
      this.scheduleReconnect({ resume: true });
      return;
    }
    if (IDENTIFY_CODES.has(code)) {
      this.sessionId = null;
      this.seq = null;
      this.scheduleReconnect({ resume: false });
      return;
    }
    this.scheduleReconnect({ resume: Boolean(this.sessionId) });
  }

  scheduleReconnect(options = {}) {
    if (this.stopping) return;
    clearTimeout(this.reconnectTimer);
    this.retries += 1;
    const delay = Math.min(1000 * 2 ** Math.min(this.retries, 5), 30000);
    this.setState('connecting', `${Math.round(delay / 1000)} 秒后重连…`);
    hub.log('info', 'gateway', `将在 ${Math.round(delay / 1000)} 秒后重连（第 ${this.retries} 次）`);
    this.reconnectTimer = setTimeout(() => {
      this.connect(options).catch((err) => {
        hub.log('error', 'gateway', `重连失败：${err.message}`);
        this.scheduleReconnect(options);
      });
    }, delay);
  }

  /* --------------------------------------------------------------- 收包 */

  handlePacket(packet) {
    const { op, d, s, t } = packet;
    if (typeof s === 'number' && s > (this.seq ?? 0)) this.seq = s;

    switch (op) {
      case 10: // Hello
        this.heartbeatInterval = d?.heartbeat_interval || 45000;
        this.startHeartbeat();
        this.sendIdentify();
        break;

      case 11: // 心跳回执
        this.acked = true;
        break;

      case 1: // 服务端要求立即心跳
        this.sendHeartbeat();
        break;

      case 7: // 要求重连
        hub.log('info', 'gateway', '服务端要求重连');
        try {
          this.ws?.close(4000);
        } catch {
          /* 忽略 */
        }
        break;

      case 9: // Invalid Session
        hub.log('warn', 'gateway', '会话失效，重新鉴权');
        this.sessionId = null;
        this.seq = null;
        setTimeout(() => {
          try {
            this.ws?.close(4000);
          } catch {
            /* 忽略 */
          }
        }, 1200);
        break;

      case 0: // Dispatch
        if (t === 'READY') {
          this.sessionId = d?.session_id || null;
          this.botUser = d?.user ? { id: d.user.id, username: d.user.username } : null;
          this.retries = 0;
          this.startedAt = Date.now();
          this.setState('online', this.botUser?.username ? `${this.botUser.username} 在线` : '在线');
          hub.log('ok', 'gateway', `鉴权成功，机器人 ${this.botUser?.username || ''} 已上线`);
          this.emit('ready', d);
        } else if (t === 'RESUMED') {
          this.retries = 0;
          this.setState('online', this.botUser?.username ? `${this.botUser.username} 在线` : '在线');
          hub.log('ok', 'gateway', '会话已恢复');
        } else if (t) {
          this.emit('event', { type: t, data: d, eventId: packet.id, seq: s });
        }
        break;

      default:
        break;
    }
  }

  /* --------------------------------------------------------------- 发包 */

  send(op, d) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(op === null ? d : { op, d }));
      return true;
    } catch (err) {
      hub.log('warn', 'gateway', `发送失败：${err.message}`);
      return false;
    }
  }

  async sendIdentify() {
    const cfg = config.get();
    const token = await getToken().catch(() => '');
    const payload = {
      op: 2,
      d: {
        token: `QQBot ${token}`,
        intents: cfg.intents,
        shard: [0, 1],
        properties: { $os: process.platform, $browser: 'qqbot-console', $device: 'qqbot-console' },
      },
    };

    if (this.pendingResume && this.sessionId) {
      payload.op = 6;
      payload.d = { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.seq ?? 0 };
      hub.log('info', 'gateway', '尝试 Resume 恢复会话');
    } else {
      hub.log('info', 'gateway', `发送 Identify，intents=${cfg.intents}`);
    }
    this.pendingResume = false;
    this.send(null, payload);
  }

  startHeartbeat() {
    this.clearHeartbeat();
    this.acked = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.acked) {
        hub.log('warn', 'gateway', '心跳未收到回执，主动重连');
        try {
          this.ws?.close(4000);
        } catch {
          /* 忽略 */
        }
        return;
      }
      this.sendHeartbeat();
    }, this.heartbeatInterval);
  }

  sendHeartbeat() {
    this.acked = false;
    this.send(1, this.seq ?? null);
  }

  clearHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

export const gateway = new Gateway();
