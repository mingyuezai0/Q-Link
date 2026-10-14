/**
 * 启动器：负责所有面向用户的提示与准备工作，被 启动控制台.bat / .command 调用。
 *
 * 之所以用 Node 而不是直接在批处理里写中文：cmd.exe 对 UTF-8 批处理文件的解析不可靠，
 * 中文会变成乱码甚至导致命令解析错误。批处理只保留 ASCII，中文一律交给这里输出。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3200);
const URL = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (s = '') => console.log(s);

/** 设置 QQBOT_LAUNCH_NO_OPEN=1 可跳过自动打开浏览器（远程 / 无桌面环境下用） */
const NO_OPEN = process.env.QQBOT_LAUNCH_NO_OPEN === '1';

function openBrowser(url) {
  if (NO_OPEN) {
    line(`  （已跳过自动打开浏览器，请手动访问 ${url}）`);
    return false;
  }
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch {
    return false;
  }
}

async function probe() {
  try {
    const res = await fetch(`${URL}/api/status`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return null;
    const data = await res.json();
    // 只认自家的服务，避免把别的程序误判成控制台
    return typeof data?.state === 'string' && 'configured' in data ? data : null;
  } catch {
    return null;
  }
}

line();
line('  ╭──────────────────────────────────────────╮');
line('  │        QQ 机器人控制台  启动器           │');
line('  ╰──────────────────────────────────────────╯');
line();

/* 版本检查（package.json 要求 >= 18） */
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  line(`  [错误] 当前 Node.js 版本是 ${process.version}，需要 18 或更高。`);
  line('         请到 https://nodejs.org 下载安装新版后重试。');
  line();
  process.exit(1);
}

/* 已经在跑就直接开浏览器，不重复启动 */
const running = await probe();
if (running) {
  line('  控制台已经在运行了，直接为你打开页面。');
  line(`  地址：${URL}`);
  line();
  openBrowser(URL);
  line('  这个窗口可以关掉，不会影响已经在运行的控制台。');
  line();
  process.exit(0);
}

/* 首次运行安装依赖 */
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  line('  首次运行，正在安装依赖（大约需要十几秒）…');
  line();
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    line();
    line('  [错误] 依赖安装失败。请检查网络后重试，或手动执行：npm install');
    line();
    process.exit(1);
  }
  line();
}

/* 启动服务 */
line('  正在启动服务…');
line();

const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT) },
});

let opened = false;
let exited = false;
child.on('exit', (code) => {
  exited = true;
  if (!opened) {
    line();
    line('  [错误] 服务没能启动，请查看上面的错误信息。');
    line(`         如果端口 ${PORT} 被其他程序占用，可以换个端口：`);
    line(process.platform === 'win32' ? `         set PORT=3300 && 启动控制台.bat` : `         PORT=3300 ./启动控制台.command`);
    line();
  }
  process.exit(code ?? 0);
});

/* 等服务就绪后自动打开浏览器 */
for (let i = 0; i < 60 && !exited; i += 1) {
  await sleep(300);
  if (await probe()) {
    opened = true;
    line('');
    line(`  ✅ 已就绪，正在打开浏览器：${URL}`);
    line('     如果浏览器没有自动打开，请手动访问上面的地址。');
    line('');
    line('  提示：关闭这个窗口即可停止机器人。');
    line('');
    openBrowser(URL);
    break;
  }
}

process.on('SIGINT', () => {
  child.kill('SIGINT');
});
