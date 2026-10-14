/**
 * 提交前的密钥自检。
 *
 * 用途：确认即将提交的内容里没有 AppSecret、API Key、token 之类的东西。
 * 这个项目把凭据都放在 data/（已被 .gitignore 排除），源码里不该出现任何真实密钥。
 *
 * 用法：
 *   npm run check:secrets          # 扫描 git 跟踪的文件
 *   npm run check:secrets -- --all # 扫描工作区所有文件（含未跟踪）
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanAll = process.argv.includes('--all');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'data', '.shots']);
const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.html', '.css', '.txt',
  '.yml', '.yaml', '.bat', '.command', '.ps1', '.sh', '.env', '.toml',
]);

/**
 * 常见的密钥形态。
 * allow 里的正则是"这个文件整体看起来就是示例/占位"的赦免条件。
 */
const PATTERNS = [
  { name: 'OpenAI 风格密钥', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Bearer 硬编码', re: /Bearer\s+[A-Za-z0-9._-]{30,}/g },
  {
    name: '疑似 appSecret 赋值',
    re: /appSecret\s*[:=]\s*['"]([^'"]{8,})['"]/g,
    allow: (v) => /MOCK|TEST|EXAMPLE|YOUR_|xxx|placeholder|示例/i.test(v),
  },
  {
    name: '疑似 apiKey 赋值',
    re: /(api[_-]?key|apiKey|access[_-]?token)\s*[:=]\s*['"]([^'"]{16,})['"]/g,
    allow: (v) => /MOCK|TEST|EXAMPLE|YOUR_|xxx|placeholder|示例/i.test(v),
  },
];

function collectTracked() {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function collectAll(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      collectAll(path.join(dir, e.name), acc);
    } else {
      acc.push(path.relative(ROOT, path.join(dir, e.name)).replace(/\\/g, '/'));
    }
  }
  return acc;
}

const files = scanAll ? collectAll(ROOT) : collectTracked();
const findings = [];
let checked = 0;

for (const rel of files) {
  const ext = path.extname(rel).toLowerCase();
  if (!TEXT_EXT.has(ext) && !/^\.(gitignore|gitattributes|env)/.test(path.basename(rel))) continue;

  let text;
  try {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    if (buf.includes(0)) continue; // 二进制
    text = buf.toString('utf8');
  } catch {
    continue;
  }
  checked += 1;

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const captured = m[1] || m[0];
      if (p.allow && p.allow(captured)) continue;
      findings.push({ file: rel, kind: p.name, sample: m[0].slice(0, 10) + '…' });
    }
  }
}

console.log('');
console.log(`  扫描范围  ${scanAll ? '工作区全部文件' : 'git 跟踪的文件'}`);
console.log(`  文本文件  ${checked} 个`);
console.log('');

if (!findings.length) {
  console.log('  没有发现疑似密钥 ✓');
  console.log('');
  process.exit(0);
}

console.log('  发现可疑内容，请人工确认：');
for (const f of findings) console.log(`    ${f.file}  [${f.kind}]  ${f.sample}`);
console.log('');
console.log('  如果确认是示例值，把它写成 MOCK_ / EXAMPLE_ / YOUR_ 开头即可自动豁免。');
console.log('');
process.exit(1);
