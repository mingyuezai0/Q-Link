import { WebSocketServer } from 'ws';

/**
 * 控制台实时通道：把机器人状态、收发消息、运行日志推给前端。
 * 保留一份最近事件，页面刷新后可立刻补齐上下文。
 */
class Hub {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.recent = [];
    this.recentLimit = 120;
    this.logHistory = [];
  }

  attach(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.send(JSON.stringify({ type: 'console:hello', payload: { at: Date.now() } }));
      for (const event of this.recent) socket.send(JSON.stringify(event));
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));
    });

    return this.wss;
  }

  broadcast(type, payload = {}) {
    const event = { type, payload, at: Date.now() };
    if (type.startsWith('console:') || type === 'message' || type === 'status' || type === 'log') {
      this.recent.push(event);
      if (this.recent.length > this.recentLimit) this.recent = this.recent.slice(-this.recentLimit);
    }
    const data = JSON.stringify(event);
    for (const socket of this.clients) {
      if (socket.readyState === 1) {
        try {
          socket.send(data);
        } catch {
          this.clients.delete(socket);
        }
      }
    }
  }

  /** 运行日志：同时进实时通道与内存历史，供「消息日志」页回填 */
  log(level, scope, message, extra = {}) {
    const entry = { level, scope, message, at: Date.now(), ...extra };
    this.logHistory.push(entry);
    if (this.logHistory.length > 300) this.logHistory.shift();
    this.broadcast('log', entry);
  }
}

export const hub = new Hub();
