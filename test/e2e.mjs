/**
 * 端到端集成测试：把官方平台换成 mock，其余全部跑真实代码路径。
 * 验证：鉴权 → 网关握手 → 收事件 → 规则链 → 调模型 → 发消息（含 msg_seq / 引用 / 富媒体）→ 重连 Resume。
 *
 * 用法：node test/e2e.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockPlatform } from './mock-platform.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_PORT = 3999;
const CONSOLE_PORT = 3311;
const BASE = `http://127.0.0.1:${CONSOLE_PORT}`;

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  → ${extra}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${data?.error || text}`);
  return data;
}

async function waitFor(fn, { timeout = 12000, interval = 120, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`等待超时：${label}`);
}

/* ------------------------------------------------------------------ 主流程 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-e2e-'));
const mock = createMockPlatform({ port: MOCK_PORT });
let child = null;

async function cleanup() {
  if (child && !child.killed) {
    child.kill();
    await sleep(400);
  }
  await mock.close().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}

try {
  await mock.listen();
  console.log(`mock 平台已启动 http://127.0.0.1:${MOCK_PORT}\n`);

  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(CONSOLE_PORT), QQBOT_DATA_DIR: dataDir },
    stdio: 'ignore',
  });

  await waitFor(() => fetch(`${BASE}/api/status`).then((r) => r.ok).catch(() => false), {
    label: '控制台启动',
  });
  console.log('控制台已启动（隔离数据目录）\n');

  /* ---------------------------------------------------- 1. 接入配置 */

  await api('PUT', '/api/config', {
    appId: '1234567890',
    appSecret: 'MOCK_SECRET',
    baseUrl: `http://127.0.0.1:${MOCK_PORT}`,
    intents: (1 << 25) | (1 << 26),
    ai: { baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: 'mock-key', model: 'mock-model' },
    reply: { maxLength: 900, quoteReply: true },
  });

  const me = await api('POST', '/api/config/test');
  check('鉴权：AppID/AppSecret 换 token 并取到机器人信息', me.bot?.username === '测试机器人', me.bot?.username);

  /* ---------------------------------------------------- 2. 启动机器人 */

  await api('POST', '/api/bot/start');
  const status = await waitFor(
    async () => {
      const s = await api('GET', '/api/status');
      return s.state === 'online' ? s : null;
    },
    { label: '机器人上线' },
  );
  check('网关：Hello → Identify → READY 后状态为在线', status.state === 'online', status.detail);
  check('网关：Identify 使用 QQBot 前缀的 access_token', String(mock.state.identify?.token || '').startsWith('QQBot '), String(mock.state.identify?.token || '').slice(0, 14) + '…');
  check('网关：intents 按配置上报', mock.state.identify?.intents === ((1 << 25) | (1 << 26)), String(mock.state.identify?.intents));
  check('网关：shard 为 [0,1]', JSON.stringify(mock.state.identify?.shard) === '[0,1]');

  await waitFor(() => (mock.state.heartbeats > 0 ? true : false), { label: '心跳' });
  check('网关：按 Hello 下发的间隔发送心跳并收到 ACK', mock.state.heartbeats > 0, `${mock.state.heartbeats} 次`);

  /* ---------------------------------------------------- 3. 准备素材 */

  const sticker = await api('POST', '/api/stickers/upload', {
    name: '开心',
    mime: 'image/png',
    tags: ['打招呼'],
    data: `data:image/png;base64,${PNG_1PX}`,
  });
  check('表情包：上传并落盘', Boolean(sticker.file) && fs.existsSync(path.join(dataDir, 'uploads', sticker.file)), sticker.file);

  const persona = await api('PUT', '/api/persona', {
    name: '小Q',
    system: '你是「小Q」，一个住在 QQ 里的 AI 伙伴。',
    greeting: '你好呀',
  });
  check('人设：保存后持久化', persona.name === '小Q');

  /* ------------------------------- 场景 A：AI 回复 + 表情包 + 引用 */

  mock.state.modelReply = '你好呀，我是小Q 👋\n[sticker:开心]';
  const sentBefore = mock.state.sent.length;
  const evA = mock.dispatch(
    'C2C_MESSAGE_CREATE',
    {
      id: 'MSG_A',
      content: '在吗',
      author: { user_openid: 'OPENID_A', username: '小明' },
      message_scene: { source: 'default', ext: ['msg_idx=REFIDX_quote_A=='] },
    },
    'EVENT_A',
  );
  check('收消息：事件外层 id 可用于被动回复', Boolean(evA.id));

  await waitFor(() => (mock.state.sent.length >= sentBefore + 2 ? true : false), { label: '文字+富媒体发送' });

  const batchA = mock.state.sent.slice(sentBefore);
  const aText = batchA[0];
  const aUpload = mock.state.uploads.at(-1);
  const aMedia = batchA[1];

  check('发消息：文字先发出，且用到了 d.id 作为 msg_id', aText.body.msg_id === 'MSG_A', aText.body.msg_id);
  check('发消息：msg_seq 从 1 开始', aText.body.msg_seq === 1, String(aText.body.msg_seq));
  check('发消息：按 message_scene.ext 的 msg_idx 做引用回复', aText.body.message_reference?.message_id === 'REFIDX_quote_A==', JSON.stringify(aText.body.message_reference));
  check('模型输出：表情包指令已从正文剥离', aText.body.content === '你好呀，我是小Q 👋', JSON.stringify(aText.body.content));
  check('富媒体：上传到单聊端点并拿到 file_info', aUpload?.body?.file_type === 1 && Boolean(aUpload?.body?.file_data), aUpload?.openid);
  check('富媒体：用 msg_type=7 + media.file_info 发图', aMedia?.body?.msg_type === 7 && aMedia?.body?.media?.file_info === 'FILE_INFO_MOCK', JSON.stringify(aMedia?.body?.media));
  check('发消息：请求头使用 QQBot 鉴权', String(aText.auth || '').startsWith('QQBot '), String(aText.auth || '').slice(0, 12) + '…');

  /* ------------------------------- 场景 B：长文本分段 + msg_seq 递增 */

  await api('PUT', '/api/config', { reply: { maxLength: 120 } });
  mock.state.modelReply = '这是一段很长的回复。'.repeat(20);
  const sentBeforeB = mock.state.sent.length;
  mock.dispatch(
    'C2C_MESSAGE_CREATE',
    { id: 'MSG_B', content: '讲个长故事', author: { user_openid: 'OPENID_B', username: '小红' } },
    'EVENT_B',
  );

  await waitFor(() => (mock.state.sent.length > sentBeforeB ? true : false), { label: '长文本首段' });
  await sleep(1800);
  const segs = mock.state.sent.slice(sentBeforeB);
  check('长文本：按 maxLength 拆成多段', segs.length >= 2, `${segs.length} 段`);
  check('长文本：每段长度不超上限', segs.every((s) => s.body.content.length <= 120), `max=${Math.max(...segs.map((s) => s.body.content.length))}`);
  check(
    '长文本：msg_seq 递增（避免 40054005 重复发送失败）',
    segs.every((s, i) => s.body.msg_seq === i + 1),
    segs.map((s) => s.body.msg_seq).join(','),
  );
  check(
    '长文本：引用只挂在第一段',
    Boolean(segs[0].body.message_reference) === false || segs.slice(1).every((s) => !s.body.message_reference),
  );

  /* ------------------------------- 场景 C：群聊走 groups 端点 */

  mock.state.modelReply = '收到！';
  const sentBeforeC = mock.state.sent.length;
  mock.dispatch(
    'GROUP_AT_MESSAGE_CREATE',
    {
      id: 'MSG_C',
      content: '今天天气如何',
      group_openid: 'GROUP_XYZ',
      author: { member_openid: 'MEMBER_C', username: '小刚' },
      message_scene: { ext: ['msg_idx=REFIDX_g==', 'auth_token=t'] },
    },
    'EVENT_C',
  );
  await waitFor(() => (mock.state.sent.length > sentBeforeC ? true : false), { label: '群聊回复' });
  const cText = mock.state.sent.slice(sentBeforeC)[0];
  check('群聊：发到 /v2/groups/{group_openid}/messages', cText.segment === 'groups' && cText.openid === 'GROUP_XYZ', `${cText.segment}/${cText.openid}`);
  check('群聊：msg_id 用群事件 id', cText.body.msg_id === 'MSG_C', cText.body.msg_id);

  /* ------------------------------- 场景 D：输出侧违禁词 */

  await api('POST', '/api/banned', {
    word: '内部消息',
    action: 'block',
    scope: 'output',
    notice: '这个话题我不太方便聊，换个话题吧。',
    enabled: true,
  });
  mock.state.modelReply = '这条是内部消息，别外传。';
  const sentBeforeD = mock.state.sent.length;
  mock.dispatch(
    'C2C_MESSAGE_CREATE',
    { id: 'MSG_D', content: '有什么消息吗', author: { user_openid: 'OPENID_D', username: '小美' } },
    'EVENT_D',
  );
  await waitFor(() => (mock.state.sent.length > sentBeforeD ? true : false), { label: '输出过滤' });
  const dText = mock.state.sent.slice(sentBeforeD)[0];
  check('违禁词：模型输出命中后替换为安全话术', dText.body.content === '这个话题我不太方便聊，换个话题吧。', JSON.stringify(dText.body.content));

  /* ------------------------------- 场景 E：关键词固定回复不调模型 */

  await api('POST', '/api/keywords', { trigger: '打卡', mode: 'fixed', reply: '今天也来啦 ✅', priority: 5, enabled: true });
  const callsBefore = mock.state.modelCalls.length;
  const sentBeforeE = mock.state.sent.length;
  mock.dispatch(
    'C2C_MESSAGE_CREATE',
    { id: 'MSG_E', content: '我来打卡', author: { user_openid: 'OPENID_E', username: '小强' } },
    'EVENT_E',
  );
  await waitFor(() => (mock.state.sent.length > sentBeforeE ? true : false), { label: '关键词回复' });
  const eText = mock.state.sent.slice(sentBeforeE)[0];
  check('关键词：固定回复内容正确', eText.body.content === '今天也来啦 ✅', JSON.stringify(eText.body.content));
  check('关键词：固定回复不调用模型（省时省钱）', mock.state.modelCalls.length === callsBefore, `模型调用 ${mock.state.modelCalls.length - callsBefore} 次`);

  /* ------------------------------- 场景 F：重复推送去重 */

  const sentBeforeF = mock.state.sent.length;
  const dupPayload = { id: 'MSG_F', content: '重复推送测试', author: { user_openid: 'OPENID_F', username: '小蓝' } };
  mock.dispatch('C2C_MESSAGE_CREATE', dupPayload, 'EVENT_F');
  await waitFor(() => (mock.state.sent.length > sentBeforeF ? true : false), { label: '首次回复' });
  mock.dispatch('C2C_MESSAGE_CREATE', dupPayload, 'EVENT_F');
  await sleep(1200);
  check('去重：同一 msg_id 重复推送只回复一次', mock.state.sent.length === sentBeforeF + 1, `共发出 ${mock.state.sent.length - sentBeforeF} 条`);

  /* ------------------------------- 场景 G：断线后 Resume 补发 */

  const resumesBefore = mock.state.resumes.length;
  mock.dropConnection(4009);
  await waitFor(() => (mock.state.resumes.length > resumesBefore ? true : false), { label: 'Resume', timeout: 15000 });
  const resume = mock.state.resumes.at(-1);
  check('重连：4009 后用 op6 Resume 并带上 session_id', resume?.session_id === 'SESSION_MOCK', JSON.stringify(resume?.session_id));
  check('重连：Resume 带上最后收到的 seq', typeof resume?.seq === 'number' && resume.seq > 0, String(resume?.seq));

  await waitFor(async () => (await api('GET', '/api/status')).state === 'online', { label: '恢复在线' });
  check('重连：恢复后状态回到在线', true);

  /* ------------------------------- 场景 H：白名单 / 黑名单 */

  // 先把对方加进黑名单（基于 openid），验证「完全不回复」
  await api('POST', '/api/people/quick', {
    openid: 'OPENID_BLACK',
    listTag: 'blacklist',
    alias: '不受欢迎的人',
    mode: 'ignore',
    scope: 'c2c',
  });
  const sentBeforeBlack = mock.state.sent.length;
  mock.dispatch(
    'C2C_MESSAGE_CREATE',
    { id: 'MSG_BLACK', content: '在吗在吗在吗', author: { user_openid: 'OPENID_BLACK', username: '路人' } },
    'EVENT_BLACK',
  );
  await sleep(2500);
  check(
    '黑名单：openid 命中后完全不回复',
    mock.state.sent.length === sentBeforeBlack,
    `仍发出了 ${mock.state.sent.length - sentBeforeBlack} 条`,
  );

  // 再把另一个人加进白名单，验证「照常回复」且态度注入生效
  await api('POST', '/api/people/quick', {
    openid: 'OPENID_WHITE',
    listTag: 'whitelist',
    alias: '老王',
    mode: 'warm',
    scope: 'c2c',
  });
  mock.state.modelReply = '哎老王！';
  const sentBeforeWhite = mock.state.sent.length;
  const callsBeforeWhite = mock.state.modelCalls.length;
  mock.dispatch(
    'C2C_MESSAGE_CREATE',
    { id: 'MSG_WHITE', content: '最近咋样', author: { user_openid: 'OPENID_WHITE', username: '' } },
    'EVENT_WHITE',
  );
  await waitFor(() => (mock.state.sent.length > sentBeforeWhite ? true : false), { label: '白名单回复' });
  check('白名单：照常回复', mock.state.sent.length === sentBeforeWhite + 1);

  const whitePrompt = mock.state.modelCalls.at(-1)?.messages?.[0]?.content || '';
  check(
    '白名单：人设提示里注入了「更放得开」的态度',
    whitePrompt.includes('熟人') && whitePrompt.includes('老王'),
    whitePrompt.includes('熟人') ? '已注入' : '未注入',
  );
  check('白名单：也确实调用了模型', mock.state.modelCalls.length > callsBeforeWhite);

  // 单聊事件里 username 为空时，日志仍要有可读的称呼
  const convs = await api('GET', '/api/conversations');
  const whiteConv = convs.find((c) => c.targetId === 'OPENID_WHITE');
  check('会话档案：按私聊/群聊分别建档', Boolean(whiteConv) && whiteConv.scope === 'c2c', whiteConv?.scope);
  check(
    '会话档案：记录到对方即使用了占位称呼',
    Boolean(whiteConv) && Object.values(whiteConv.members || {}).length === 1,
    JSON.stringify(Object.values(whiteConv?.members || {}).map((m) => m.name)),
  );

  const ids = await api('GET', '/api/identities');
  check('身份档案：见过的 openid 都被记下', ids.some((i) => i.openid === 'OPENID_A') && ids.some((i) => i.openid === 'OPENID_BLACK'));
  check(
    '身份档案：标注出他属于哪份名单',
    ids.find((i) => i.openid === 'OPENID_BLACK')?.listTag === 'blacklist',
    ids.find((i) => i.openid === 'OPENID_BLACK')?.listTag,
  );

  /* ------------------------------- 场景 I：多机器人配置互相隔离 */

  const before = await api('GET', '/api/bots');
  const firstId = before.activeId;
  const first = before.bots.find((b) => b.id === firstId);
  const created = await api('POST', '/api/bots', { name: '第二台机器人' });
  const secondId = created.bot.id;
  await api('POST', `/api/bots/${secondId}/activate`);

  const secondKeywords = await api('GET', '/api/keywords');
  const secondConfig = await api('GET', '/api/config');
  check('多机器人：新建后切换，关键词是独立的一份', secondKeywords.length === 0, `${secondKeywords.length} 条`);
  check('多机器人：接入凭据也互相独立', !secondConfig.appId, `appId=${secondConfig.appId || '(空)'}`);

  await api('PUT', `/api/bots/${secondId}`, { name: '改过名字的二号' });
  const botsNow = await api('GET', '/api/bots');
  check(
    '多机器人：改名与资料只影响自己',
    botsNow.bots.find((b) => b.id === secondId)?.name === '改过名字的二号' &&
      botsNow.bots.find((b) => b.id === firstId)?.name === first.name,
    `${botsNow.bots.find((b) => b.id === secondId)?.name} / ${botsNow.bots.find((b) => b.id === firstId)?.name}`,
  );
  check('多机器人：列表里标出了当前使用中的那台', botsNow.bots.find((b) => b.id === secondId)?.active === true);

  await api('POST', `/api/bots/${before.activeId}/activate`);
  const backKeywords = await api('GET', '/api/keywords');
  check('多机器人：切回去原来的词库还在', backKeywords.length === 1, `${backKeywords.length} 条`);

  // 切机器人会断开连接，这里重新启动以便后续断言
  await api('POST', '/api/bot/start');
  await waitFor(async () => (await api('GET', '/api/status')).state === 'online', { label: '重新上线' });

  /* ------------------------------- 场景 J：持久化 */

  const stats = await api('GET', '/api/stats');
  const logList = await api('GET', '/api/logs?limit=80');
  check('持久化：消息记录已写入日志', stats.messages > 0, `${stats.messages} 条`);
  check('持久化：日志含收发两个方向', logList.some((l) => l.kind === 'in') && logList.some((l) => l.out !== undefined || l.kind === 'out'));
  check('持久化：被黑名单拦下的消息有留痕', logList.some((l) => l.kind === 'blocked'));

  const botDir = path.join(dataDir, 'bots', 'default');
  const botFiles = fs.existsSync(botDir) ? fs.readdirSync(botDir) : [];
  check(
    '持久化：每台机器人的数据落在自己的目录里',
    ['config.json', 'persona.json', 'keywords.json', 'banned.json', 'stickers.json', 'logs.json', 'people.json'].every((f) =>
      botFiles.includes(f),
    ),
    botFiles.join(','),
  );
  check(
    '持久化：上传的图片单独存放',
    fs.existsSync(path.join(dataDir, 'uploads')) && fs.readdirSync(path.join(dataDir, 'uploads')).length > 0,
  );
  check('持久化：机器人登记表存在', fs.existsSync(path.join(dataDir, 'bots.json')));
} catch (err) {
  check(`测试执行未抛异常：${err.message}`, false);
} finally {
  await cleanup();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('\n失败项：');
  for (const f of failed) console.log(`  · ${f.name}${f.extra ? ` (${f.extra})` : ''}`);
}
process.exit(failed.length ? 1 : 0);
