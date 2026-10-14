/**
 * 上传前的最后一道检查：拿磁盘上的真实密钥值，去搜即将提交的内容。
 *
 * 比正则匹配模式更可靠 —— 直接问"这两个真实的字符串在不在里面"。
 * 密钥值本身不会打印出来。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const cfgPath = path.join(ROOT, 'data', 'bots', 'default', 'config.json');

if (!fs.existsSync(cfgPath)) {
  console.log('没有找到 data/bots/default/config.json，跳过（无密钥可比对）');
  process.exit(0);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const secrets = [
  ['appSecret', cfg.appSecret],
  ['ai.apiKey', cfg.ai?.apiKey],
].filter(([, v]) => typeof v === 'string' && v.length >= 12);

if (!secrets.length) {
  console.log('配置里没有可比的密钥值');
  process.exit(0);
}

// 即将提交的全部内容
const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

console.log(`待提交 ${staged.length} 个文件`);
console.log(`用 ${secrets.length} 个真实密钥值（长度 ${secrets.map(([, v]) => v.length).join(' / ')}）逐文件比对`);
console.log('');

let hit = 0;
for (const file of staged) {
  const full = path.join(ROOT, file);
  let text;
  try {
    if (!fs.statSync(full).isFile()) continue;
    // 二进制跳过
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) continue;
    text = buf.toString('utf8');
  } catch {
    continue;
  }
  for (const [name, value] of secrets) {
    if (text.includes(value)) {
      console.log(`  ✗ 泄密！${file} 里出现了 ${name}`);
      hit += 1;
    }
  }
}

console.log('');
console.log(hit === 0 ? '结论：待提交内容里没有任何真实密钥 ✓' : `结论：发现 ${hit} 处，必须处理后再提交 ✗`);
process.exit(hit === 0 ? 0 : 1);
