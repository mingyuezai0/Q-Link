/**
 * 桌面版启动器。
 *
 * 优先用项目本地的 electron，找不到就回退到 D:\electron 里那份已经装好的，
 * 这样不用为了跑起来先下载三百多兆的 Electron。
 *
 * 可以用 QLINK_ELECTRON 指定 electron.exe 的完整路径。
 */
import { spawn } from 'node:child_process';
import { findElectronBinary, ROOT } from './find-tools.mjs';

/**
 * 传给 Electron 的环境变量。
 *
 * 必须删掉 ELECTRON_RUN_AS_NODE：只要它存在，electron.exe 会退化成普通 Node，
 * 于是主进程里的 require('electron') 直接 MODULE_NOT_FOUND，窗口一个都不会出现
 * （表现为"点了没反应，进程秒退"）。从别的 Electron 应用派生的终端里启动时最容易踩到。
 */
function childEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  if (env.ELECTRON_RUN_AS_NODE) {
    console.log('  注意：检测到 ELECTRON_RUN_AS_NODE，已为本次启动清除');
    console.log('        （不清的话 Electron 会退化成普通 Node，窗口起不来）');
    console.log('');
    delete env.ELECTRON_RUN_AS_NODE;
  }
  return env;
}

const exe = findElectronBinary();
if (!exe) {
  console.error('');
  console.error('  没有找到 Electron。');
  console.error('');
  console.error('  三选一：');
  console.error('    1) 在本项目里装一份：  npm i -D electron');
  console.error('    2) 指定已有路径：      set QLINK_ELECTRON=D:\\electron\\node_modules\\electron\\dist\\electron.exe');
  console.error('    3) 去 https://www.electronjs.org 下载后放进 PATH');
  console.error('');
  process.exit(1);
}

console.log('');
console.log('  Q-Link 桌面版');
console.log(`  Electron  ${exe}`);
console.log('  正在启动，窗口稍后出现…');
console.log('');

const env = childEnv();
const child = spawn(exe, [ROOT], { stdio: 'inherit', windowsHide: false, env });
child.on('exit', (code) => process.exit(code ?? 0));
