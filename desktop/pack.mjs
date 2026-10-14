/**
 * 打包桌面版安装包。
 *
 * 用法：
 *   node desktop/pack.mjs            # 解包目录（最快，用来验证打包结果能不能跑）
 *   node desktop/pack.mjs portable   # 免安装单文件 exe
 *   node desktop/pack.mjs nsis       # 安装向导 exe
 *   node desktop/pack.mjs all        # 两个都出
 *
 * 会用自动找到的 Electron（项目本地优先，否则用 D:\electron 那份）作为运行时，
 * 所以不需要先下载一遍 Electron。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { findElectronBuilder, findElectronDist, ROOT, toPosix } from './find-tools.mjs';

const mode = (process.argv[2] || 'dir').toLowerCase();

const dist = findElectronDist();
if (!dist) {
  console.error('');
  console.error('  没有找到 Electron，无法打包。');
  console.error('  装一份：npm i -D electron');
  console.error('  或指定：set QLINK_ELECTRON=D:\\electron\\node_modules\\electron\\dist\\electron.exe');
  console.error('');
  process.exit(1);
}

const builder = findElectronBuilder();
if (!builder) {
  console.error('');
  console.error('  没有找到 electron-builder。');
  console.error('  装一份：npm i -D electron-builder');
  console.error('  或指定 QLINK_ELECTRON_HOME 指向已装好的目录（例如 D:\\electron）。');
  console.error('');
  process.exit(1);
}

const targets = mode === 'all' ? ['portable', 'nsis'] : mode === 'dir' ? [] : [mode];

console.log('');
console.log('  Q-Link 打包');
console.log(`  electron        ${dist.version || '(版本未知)'}`);
console.log(`  electron dist   ${dist.dist}`);
console.log(`  electron-builder ${builder}`);
console.log(`  目标            ${targets.length ? targets.join(' + ') : '解包目录（--dir）'}`);
console.log('');

const args = [
  // 关键：不填这两个，electron-builder 会因为项目里没装 electron 而直接报错
  `-c.electronVersion=${dist.version}`,
  `-c.electronDist=${toPosix(dist.dist)}`,
];

if (targets.length) {
  args.push('--win', ...targets);
} else {
  args.push('--win', '--dir');
}

const child = spawn(process.execPath, [builder, ...args], {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: false,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
});
child.on('exit', (code) => {
  if (code === 0) {
    console.log('');
    console.log(`  打包完成，产物在 ${path.join(ROOT, 'dist')}`);
    console.log('');
  }
  process.exit(code ?? 0);
});
