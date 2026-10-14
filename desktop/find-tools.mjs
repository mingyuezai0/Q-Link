/**
 * 在几个常见位置找 Electron 与 electron-builder。
 *
 * 优先用项目自己的 devDependency；找不到就回退到独立安装（例如 D:\electron），
 * 这样不装那三百多兆也能直接跑起来和打包。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
const isWin = process.platform === 'win32';

/** 独立安装的候选根目录 */
const STANDALONE_ROOTS = [
  process.env.QLINK_ELECTRON_HOME,
  'D:\\electron',
  'D:\\Electron',
  'C:\\electron',
  path.join(ROOT, 'node_modules', 'electron'),
].filter(Boolean);

function statFile(p) {
  try {
    return p && fs.statSync(p).isFile() ? p : null;
  } catch {
    return null;
  }
}

/** 找到 electron 可执行文件 */
export function findElectronBinary() {
  const candidates = [];
  if (process.env.QLINK_ELECTRON) candidates.push(process.env.QLINK_ELECTRON);

  for (const base of STANDALONE_ROOTS) {
    candidates.push(path.join(base, 'dist', isWin ? 'electron.exe' : 'electron'));
    candidates.push(path.join(base, 'node_modules', 'electron', 'dist', isWin ? 'electron.exe' : 'electron'));
  }

  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, isWin ? 'electron.exe' : 'electron'));
  }

  for (const p of candidates) {
    const hit = statFile(p);
    if (hit) return hit;
  }
  return null;
}

/** 找到 electron 的 dist 目录与版本号（打包时要用） */
export function findElectronDist() {
  const bin = findElectronBinary();
  if (!bin) return null;
  const dist = path.dirname(bin);

  // 版本号在 dist/../package.json（electron 包自己的）
  const pkgPath = path.join(dist, '..', 'package.json');
  let version = process.env.QLINK_ELECTRON_VERSION || '';
  try {
    version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || version;
  } catch {
    /* 拿不到就让调用方处理 */
  }
  return { dist, version, binary: bin };
}

/**
 * 找到 electron-builder 的 JS 入口。
 *
 * 故意返回 cli.js 而不是 .cmd：Node 20+ 出于安全考虑拒绝直接 spawn .cmd/.bat
 * （会抛 spawn EINVAL），而且用 node 直接跑 JS 还能正确处理带空格的路径。
 */
export function findElectronBuilder() {
  const rel = path.join('electron-builder', 'out', 'cli', 'cli.js');
  const bases = [];

  for (const base of STANDALONE_ROOTS) {
    // <home>/node_modules/electron-builder/...  或  <home>/../node_modules/...
    bases.push(path.join(base, 'node_modules', rel));
    bases.push(path.resolve(base, '..', 'node_modules', rel));
  }
  bases.push(path.join(ROOT, 'node_modules', rel));

  for (const p of bases) {
    const hit = statFile(p);
    if (hit) return hit;
  }
  return null;
}

/** 把路径规整成 electron-builder 能吃的正斜杠形式 */
export const toPosix = (p) => p.replace(/\\/g, '/');
