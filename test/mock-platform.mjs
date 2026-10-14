/**
 * 模拟 QQ 开放平台：把官方接口按文档行为实现一遍，用于端到端验证控制台的收发链路。
 * 只用于测试，不参与运行时。
 *
 * 覆盖：access_token、网关地址、WebSocket(Hello/Identify/心跳/Resume)、
 *      单聊与群聊发消息、富媒体上传、机器人详情，以及一个 OpenAI 兼容的模型端点。
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';

export function createMockPlatform({ port = 3999 } = {}) {
  const state = {
    tokenRequests: 0,
    tokens: [],
    sent: [], // 平台收到的发消息请求
    uploads: [],
    identify: null,
    resumes: [],
    heartbeats: 0,
    httpLog: [],
    modelReply: '你好呀，我是小Q 👋',
    modelCalls: [],
    sockets: new Set(),
  };

  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => resolve(data));
    });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const raw = await readBody(req);
    state.httpLog.push(`${req.method} ${url.pathname}`);

    const json = (obj, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    // 取 token：文档规定失败时 HTTP 仍是 200，靠 code 判断
    if (url.pathname === '/app/getAppAccessToken') {
      const body = JSON.parse(raw || '{}');
      if (!body.appId || !body.clientSecret) return json({ code: 100016, message: 'invalid appid or secret' });
      state.tokenRequests += 1;
      const access_token = `MOCK_TOKEN_${state.tokenRequests}`;
      state.tokens.push(access_token);
      // 故意用字符串返回 expires_in，复现文档里"字段表写 number、示例写字符串"的不一致
      return json({ access_token, expires_in: '7200' });
    }

    if (url.pathname === '/gateway') {
      if (req.headers.authorization !== `QQBot ${state.tokens.at(-1)}`) {
        return json({ code: 11243, message: 'ErrorCheckTokenNotPass' });
      }
      return json({ url: `ws://127.0.0.1:${port}/websocket` });
    }

    if (url.pathname === '/users/@me') return json({ id: '1000001', username: '测试机器人', avatar: '' });

    // 发消息（单聊 / 群聊），openid 在 path 上
    const msgMatch = url.pathname.match(/^\/v2\/(users|groups)\/([^/]+)\/messages$/);
    if (msgMatch) {
      const body = JSON.parse(raw || '{}');
      state.sent.push({
        segment: msgMatch[1],
        openid: decodeURIComponent(msgMatch[2]),
        body,
        auth: req.headers.authorization,
      });
      return json({
        id: `REPLY_${state.sent.length}`,
        timestamp: new Date().toISOString(),
        ext_info: { ref_idx: 'REFIDX_reply==' },
      });
    }

    // 富媒体上传
    const fileMatch = url.pathname.match(/^\/v2\/(users|groups)\/([^/]+)\/files$/);
    if (fileMatch) {
      const body = JSON.parse(raw || '{}');
      state.uploads.push({ segment: fileMatch[1], openid: decodeURIComponent(fileMatch[2]), body });
      if (!body.file_data && !body.url) return json({ code: 850019, message: '不支持的文件格式' });
      return json({ file_uuid: 'uuid_mock', file_info: 'FILE_INFO_MOCK', ttl: 300 });
    }

    // OpenAI 兼容模型端点
    if (url.pathname === '/v1/chat/completions') {
      const body = JSON.parse(raw || '{}');
      state.modelCalls.push({ messages: body.messages, model: body.model });
      const reply = typeof state.modelReply === 'function' ? state.modelReply(body) : state.modelReply;
      return json({
        model: body.model || 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      });
    }

    return json({ code: 404, message: `mock 未实现：${req.method} ${url.pathname}` }, 404);
  });

  const wss = new WebSocketServer({ server, path: '/websocket' });
  let seq = 0;

  wss.on('connection', (ws) => {
    state.sockets.add(ws);
    ws.on('close', () => state.sockets.delete(ws));
    // 建连后第一帧必须是 Hello
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 3000 } }));

    ws.on('message', (frame) => {
      let packet;
      try {
        packet = JSON.parse(frame.toString());
      } catch {
        return;
      }
      switch (packet.op) {
        case 1: // 心跳
          state.heartbeats += 1;
          ws.send(JSON.stringify({ op: 11 }));
          break;
        case 2: // Identify
          state.identify = packet.d;
          if (!String(packet.d?.token || '').startsWith('QQBot ')) {
            ws.close(4004, 'bad token format');
            return;
          }
          ws.send(
            JSON.stringify({
              op: 0,
              s: ++seq,
              t: 'READY',
              d: { version: 1, session_id: 'SESSION_MOCK', user: { id: '1000001', username: '测试机器人', bot: true }, shard: [0, 0] },
            }),
          );
          break;
        case 6: // Resume
          state.resumes.push(packet.d);
          ws.send(JSON.stringify({ op: 0, s: ++seq, t: 'RESUMED', d: '' }));
          break;
        default:
          break;
      }
    });
  });

  return {
    state,
    /** 推送一个事件到网关 */
    dispatch(type, data, eventId) {
      const frame = { id: eventId || `EVENT_${seq + 1}`, op: 0, s: ++seq, t: type, d: data };
      for (const ws of state.sockets) {
        if (ws.readyState === 1) ws.send(JSON.stringify(frame));
      }
      return frame;
    },
    /** 让网关主动断开，用于验证重连 / Resume */
    dropConnection(code = 4009) {
      for (const ws of state.sockets) ws.close(code, 'mock drop');
    },
    listen: () =>
      new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`))),
    close: () =>
      new Promise((resolve) => {
        for (const ws of state.sockets) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}
