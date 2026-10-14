/**
 * 仅用于本地视觉核对：在隔离的数据目录里造一份演示会话数据。
 * 用法：node test/seed-demo.mjs <目标目录>
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('需要传入目标数据目录');
  process.exit(1);
}

const bot = path.join(dir, 'bots', 'default');
fs.mkdirSync(bot, { recursive: true });

const now = Date.now();
const memberA = 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4';
const memberB = 'B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5';
const c2c = 'C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6';
const group = 'D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1';

const write = (name, data) => fs.writeFileSync(path.join(bot, name), JSON.stringify(data, null, 2), 'utf8');

write('../bots.json'.replace('../', ''), {}); // 占位，下面覆盖
fs.writeFileSync(
  path.join(dir, 'bots.json'),
  JSON.stringify(
    {
      activeId: 'default',
      order: ['default'],
      meta: {
        default: {
          id: 'default',
          name: '星屑',
          avatar: '',
          appId: '1905788965',
          source: 'qr',
          createdAt: now - 604800000,
          lastUsedAt: now,
        },
      },
    },
    null,
    2,
  ),
  'utf8',
);

write('conversations.json', {
  [`c2c:${c2c}`]: {
    id: `c2c:${c2c}`,
    scope: 'c2c',
    targetId: c2c,
    name: '老王',
    lastText: '那生日礼物就拜托你了',
    members: { [c2c]: { key: c2c, name: '老王', count: 6, firstAt: now - 86400000, lastAt: now - 60000 } },
    counts: { in: 4, out: 3 },
    firstAt: now - 86400000,
    lastAt: now - 60000,
  },
  [`group:${group}`]: {
    id: `group:${group}`,
    scope: 'group',
    targetId: group,
    name: '摸鱼交流群',
    lastText: '好耶',
    members: {
      [memberA]: { key: memberA, name: '小明', count: 9, firstAt: now - 172800000, lastAt: now - 120000 },
      [memberB]: { key: memberB, name: '小红', count: 4, firstAt: now - 172800000, lastAt: now - 300000 },
    },
    counts: { in: 9, out: 5 },
    firstAt: now - 172800000,
    lastAt: now - 120000,
  },
});

write('identities.json', {
  [c2c]: { openid: c2c, scope: 'c2c', name: '老王', names: ['老王'], groups: [], count: 4, firstAt: now - 86400000, lastAt: now - 60000 },
  [memberA]: { openid: memberA, scope: 'group', name: '小明', names: ['小明'], groups: [group], groupId: group, count: 9, firstAt: now - 172800000, lastAt: now - 120000 },
  [memberB]: { openid: memberB, scope: 'group', name: '小红', names: ['小红'], groups: [group], groupId: group, count: 4, firstAt: now - 172800000, lastAt: now - 300000 },
});

write('people.json', [
  {
    id: 'p1',
    alias: '老王',
    note: '同事，认识很久了',
    mode: 'warm',
    listTag: 'whitelist',
    enabled: true,
    openids: [{ openid: c2c, scope: 'c2c', name: '老王', count: 4, firstAt: now - 86400000, lastAt: now - 60000 }],
    createdAt: now - 86400000,
  },
]);

write('logs.json', [
  { id: 'l1', at: now - 70000, kind: 'in', scope: 'c2c', peerId: c2c, targetId: c2c, userName: '老王', listTag: 'whitelist', text: '对了，我生日快到了' },
  { id: 'l2', at: now - 65000, kind: 'out', scope: 'c2c', peerId: c2c, targetId: c2c, userName: '老王', listTag: 'whitelist', text: '记得呢，3 月 5 号。你上次说想要一把机械键盘？' },
  { id: 'l3', at: now - 61000, kind: 'in', scope: 'c2c', peerId: c2c, targetId: c2c, userName: '老王', listTag: 'whitelist', text: '你居然还记得' },
  { id: 'l4', at: now - 60000, kind: 'out', scope: 'c2c', peerId: c2c, targetId: c2c, userName: '老王', listTag: 'whitelist', text: '挑的时候注意别选太吵的轴体就行' },
  { id: 'l5', at: now - 300000, kind: 'in', scope: 'group', peerId: `${group}:${memberB}`, targetId: group, userName: '小红', text: '机器人今天怎么这么安静' },
  { id: 'l6', at: now - 290000, kind: 'out', scope: 'group', peerId: `${group}:${memberB}`, targetId: group, userName: '小红', text: '我在的，只是刚才在摸鱼 🐟' },
  { id: 'l7', at: now - 120000, kind: 'in', scope: 'group', peerId: `${group}:${memberA}`, targetId: group, userName: '小明', text: '帮我看看这个生日礼物选哪个' },
  { id: 'l8', at: now - 119000, kind: 'out', scope: 'group', peerId: `${group}:${memberA}`, targetId: group, userName: '小明', text: '好耶' },
]);

write('keywords.json', [
  { id: 'k1', trigger: '生日礼物', alias: ['礼物'], matchType: 'contains', mode: 'recall', detail: '他想要一把机械键盘，预算 500 左右，生日是 3 月 5 日；不喜欢太吵的轴体。', priority: 3, enabled: true, source: 'manual', hits: 2 },
  { id: 'k2', trigger: '规则', matchType: 'contains', mode: 'ai', reply: '用三条以内的短句回答，不要用列表', priority: 1, enabled: true, source: 'manual', hits: 0 },
]);

write('config.json', { appId: '1905788965', appSecret: 'demo-only', intents: 100663296, baseUrl: 'http://127.0.0.1:1' });

console.log('演示数据已写入', bot);
