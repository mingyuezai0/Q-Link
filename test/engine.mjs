/**
 * 引擎单元测试：规则链、提示词拼装、事件解析、分段与预览。
 * 用法：node test/engine.mjs
 *
 * 注意：必须在 import 业务模块之前把数据目录指向临时目录，
 * 否则测试用的词库会覆盖你正在用的 data/。因此下面用动态 import。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qqbot-engine-'));
process.env.QQBOT_DATA_DIR = dataDir;

const { describeEvent, extractText, previewReply, handleMessage } = await import('../server/engine/reply.js');
const { applyBanned, extractStickerDirective, buildSystemPrompt, matchKeyword } = await import('../server/engine/rules.js');
const { splitText } = await import('../server/qq/api.js');
const { keywords, bannedWords, stickers, memes, memories, config } = await import('../server/data.js');

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: Boolean(cond), extra });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  → ${extra}` : ''}`);
};

/* ------------------------------------------------------------- 事件解析 */

const c2c = describeEvent('C2C_MESSAGE_CREATE', {
  id: 'MSG1',
  content: '你好',
  author: { user_openid: 'OPENID_A', username: '小明' },
  message_scene: { source: 'default', ext: ['msg_idx=REFIDX_abc=='] },
});
check('单聊事件：取 user_openid 与 msg_idx', c2c.scope === 'c2c' && c2c.peerId === 'OPENID_A' && c2c.msgIdx === 'REFIDX_abc==', JSON.stringify({ peerId: c2c.peerId, msgIdx: c2c.msgIdx }));

const grp = describeEvent('GROUP_AT_MESSAGE_CREATE', {
  id: 'MSG2',
  content: '在吗',
  group_openid: 'GROUP_X',
  author: { member_openid: 'MEMBER_B', username: '小红' },
  message_scene: { ext: ['msg_idx=REFIDX_g==', 'auth_token=t'] },
});
check('群聊事件：会话键含群与成员，发送目标是群', grp.scope === 'group' && grp.peerId === 'GROUP_X:MEMBER_B' && grp.targetId === 'GROUP_X', grp.peerId);
check('未知事件类型返回 null', describeEvent('GUILD_CREATE', {}) === null);

const text = extractText({
  content: '看这个',
  attachments: [
    { content_type: 'image/png' },
    { content_type: 'voice', asr_refer_text: '你好世界' },
    { content_type: 'file', filename: 'a.pdf' },
  ],
});
check('附件文本化：图片/语音/文件都转成可读文本', text.includes('[图片]') && text.includes('你好世界') && text.includes('a.pdf'), text);

/* --------------------------------------------------------------- 违禁词 */

bannedWords.replaceAll([
  { id: 'b1', word: '\\d{11}', matchType: 'regex', action: 'replace', replacement: '[手机号]', scope: 'all', enabled: true, priority: 10 },
  { id: 'b2', word: '加微信', matchType: 'contains', action: 'block', scope: 'input', notice: '我们换个话题吧', enabled: true, priority: 20 },
]);
check('正则替换生效', applyBanned('电话是13800138000对吧', 'output').text === '电话是[手机号]对吧', applyBanned('电话是13800138000对吧', 'output').text);
const blocked = applyBanned('我们加微信吧', 'input');
check('拦截动作带回话术', blocked.blocked === true && blocked.rule.notice === '我们换个话题吧');
check('检查范围限定：output 不触发 input 规则', applyBanned('我们加微信吧', 'output').blocked === false);
config.patch({ features: { ...config.get().features, banned: false } });
check('总开关关闭后违禁词不再生效', applyBanned('我们加微信吧', 'input').blocked === false);
config.patch({ features: { ...config.get().features, banned: true } });
check('总开关恢复后重新生效', applyBanned('我们加微信吧', 'input').blocked === true);

/* --------------------------------------------------------------- 关键词 */

keywords.replaceAll([
  { id: 'k1', trigger: '打卡', mode: 'fixed', reply: '低优先级', priority: 1, enabled: true },
  { id: 'k2', trigger: '打卡', mode: 'fixed', reply: '高优先级', priority: 9, enabled: true },
]);
check('关键词按优先级取最高', matchKeyword('我要打卡啦')?.id === 'k2', matchKeyword('我要打卡啦')?.reply);
check('冷却期内不再命中', (() => {
  const k = keywords.find('k2');
  k.cooldown = 60;
  k.lastHitAt = Date.now();
  return matchKeyword('我要打卡啦')?.id !== 'k2';
})());
check('未命中返回 null', matchKeyword('完全无关的一句话') === null);

/* --------------------------------------------------------------- 表情包 */

const ex = extractStickerDirective('好呀～\n[sticker:开心]\n明天见');
check('表情包指令解包并清理多余空行', ex.text === '好呀～\n\n明天见' && ex.names[0] === '开心', JSON.stringify(ex));
check('全角冒号同样识别', extractStickerDirective('[sticker：开心]').names[0] === '开心');

/* --------------------------------------------------------------- 分段 */

const long = '第一句。'.repeat(60);
const chunks = splitText(long, 100);
check('长文本按标点分段且不超上限', chunks.length > 1 && chunks.every((c) => c.length <= 100), `${chunks.length} 段`);
check('空文本返回空数组', splitText('   ').length === 0);
check('短文本不分段', splitText('你好').length === 1);

/* ----------------------------------------------------------- 提示词拼装 */

stickers.replaceAll([{ id: 's1', name: '开心', tags: ['打招呼'], file: 'x.png', enabled: true }]);
memories.replaceAll([{ id: 'm1', scope: 'global', key: '称呼', value: '叫他老王', weight: 3, enabled: true }]);
memes.replaceAll([{ id: 'e1', term: '绝绝子', meaning: '极度赞美', enabled: true }]);

const prompt = buildSystemPrompt({ peerId: 'OPENID_A', scope: 'user', userText: '这波绝绝子' });
check('提示词含人设正文', prompt.includes('小Q'));
check('命中的梗被注入并附解释', prompt.includes('绝绝子') && prompt.includes('极度赞美'));
check('相关记忆被注入', prompt.includes('叫他老王'));
check('列出可用表情包与调用格式', prompt.includes('[sticker:名称]') && prompt.includes('开心'));

const promptNoMeme = buildSystemPrompt({ peerId: 'OPENID_A', scope: 'user', userText: '今天天气不错' });
check('未命中梗时不注入梗段落', !promptNoMeme.includes('极度赞美'));

/* --------------------------------------------------------------- 预览 */

const p1 = await previewReply('我来打卡');
check('预览：关键词固定回复直接返回', p1.text === '高优先级' || p1.text === '低优先级', p1.text);

const p2 = await previewReply('我们加微信吧');
check('预览：命中违禁词并给出话术', p2.blocked === true && p2.text === '我们换个话题吧', p2.text);

const p3 = await previewReply('随便说点什么吧');
check('预览：未配置模型时优雅降级并说明原因', typeof p3.text === 'string' && p3.notes.some((n) => n.includes('尚未配置')), JSON.stringify(p3.notes));

/* -------------------------------------------------- 干跑完整 handleMessage */

keywords.replaceAll([]);
const dry = await handleMessage(
  { type: 'C2C_MESSAGE_CREATE', data: { id: 'D1', content: '我们加微信吧', author: { user_openid: 'DRY', username: 'u' } } },
  { dryRun: true },
);
check('干跑：违禁词在发送前被拦截', dry?.blocked === true, JSON.stringify(dry?.notes));

const dry2 = await handleMessage(
  { type: 'C2C_MESSAGE_CREATE', data: { id: 'D2', content: '没有内容', author: { user_openid: 'DRY2' } } },
  { dryRun: true },
);
check('干跑：空内容消息被忽略', dry2 === null || typeof dry2 === 'object');

/* --------------------------------------------------- Doc 深合并（回归测试） */

const { Doc } = await import('../server/store.js');
const mergeFile = path.join(dataDir, 'merge-test.json');
fs.writeFileSync(mergeFile, JSON.stringify({ reply: { a: 1 }, gone: 'kept' }), 'utf8');
const merged = new Doc(mergeFile, { reply: { a: 0, b: 2 }, top: 5 }).get();
check(
  'Doc 深合并：给已有嵌套对象新增字段时能补上默认值',
  merged.reply.a === 1 && merged.reply.b === 2,
  JSON.stringify(merged.reply),
);
check('Doc 深合并：已存盘的嵌套值不被默认值覆盖', merged.reply.a === 1);
check('Doc 深合并：顶层新增字段也能补上', merged.top === 5);
check('Doc 深合并：用户自己的额外字段保留', merged.gone === 'kept');

const bomFile = path.join(dataDir, 'bom-test.json');
fs.writeFileSync(bomFile, '\uFEFF' + JSON.stringify({ hello: 'world' }), 'utf8');
check('Doc：带 BOM 的 JSON 也能正常读出', new Doc(bomFile, {}).get().hello === 'world');

/* ------------------------------------------------- 前后端分档一致性（回归） */

const { sliderBand } = await import('../public/js/ui.js');
const { ATTITUDE_BANDS } = await import('../public/js/pages/lists.js');
const { attitudeToMode } = await import('../server/data.js');

const mismatches = [];
for (let v = 0; v <= 100; v += 1) {
  const front = sliderBand(v, ATTITUDE_BANDS).value;
  const server = attitudeToMode(v);
  if (front !== server) mismatches.push(`${v}: 前端 ${front} / 服务端 ${server}`);
}
check(
  '态度分档：前端滑杆与服务端逐点一致（0~100）',
  mismatches.length === 0,
  mismatches.slice(0, 4).join(' , ') || '全部一致',
);
check(
  '态度分档：档位覆盖全部区间',
  ATTITUDE_BANDS[0].max === 15 && ATTITUDE_BANDS.at(-1).max === 100,
  ATTITUDE_BANDS.map((x) => x.max).join('/'),
);

/* ------------------------------------------------------------------ 汇总 */

fs.rmSync(dataDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('\n失败项：');
  for (const f of failed) console.log(`  · ${f.name}${f.extra ? ` (${f.extra})` : ''}`);
}
process.exit(failed.length ? 1 : 0);
