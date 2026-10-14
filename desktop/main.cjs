/**
 * Q-Link 桌面外壳（Electron 主进程）。
 *
 * 设计要点：
 *  1. 后端原样复用 server/index.js，不复制一份逻辑 —— 通过 startServer() 嵌进来。
 *  2. 数据目录必须重定向到可写位置。打包后程序目录在 asar 里是只读的，
 *     写 <程序目录>/data 会直接失败，所以指到 app.getPath('userData')。
 *  3. 窗口外观跟随应用内的白天/黑夜模式：标题栏按钮区域、窗口底色、原生控件
 *     都跟着切换，避免"外壳是白的、里面是黑的"这种割裂感。
 *  4. 端口优先固定（保证 localStorage 里的主题选择等不因 origin 变化而丢失），
 *     被占用时自动退到随机空闲端口。
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const TOPBAR_H = 56; // 与 public/css/app.css 的 --topbar-h 保持一致
const PREFERRED_PORT = Number(process.env.QLINK_PORT || 3200);

/** 两套外壳配色，取自 public/css/app.css 里的同名变量 */
const SHELL_THEME = {
  light: { bg: '#ffffff', chrome: '#ffffff', symbol: '#1a1a1a', source: 'light' },
  dark: { bg: '#16181c', chrome: '#16181c', symbol: '#e6e9ec', source: 'dark' },
};

let theme = 'light';
let win = null;
let tray = null;
let serverInfo = null;
let quitting = false;

/* ------------------------------------------------------------------ 日志
   Electron 在 Windows 上是 GUI 子系统程序，console.log 不会出现在任何终端里，
   所以启动过程必须落盘，出问题时才有得查。 */

function logToFile(line) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'main.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* 日志写不了也不能影响启动 */
  }
}

function log(...parts) {
  const line = parts
    .map((p) => (typeof p === 'string' ? p : p instanceof Error ? `${p.message}\n${p.stack}` : JSON.stringify(p)))
    .join(' ');
  logToFile(line);
}

// 把主进程里没接住的异常也记下来
process.on('uncaughtException', (err) => log('uncaughtException', err));
process.on('unhandledRejection', (err) => log('unhandledRejection', err));

/* --------------------------------------------------------------- 外观设置 */

const settingsPath = () => path.join(app.getPath('userData'), 'shell.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), ...patch }, null, 2), 'utf8');
  } catch {
    /* 存不下就只在本次运行里生效，不影响功能 */
  }
}

const palette = () => SHELL_THEME[theme] || SHELL_THEME.light;

/** 把主题应用到窗口外壳：标题栏按钮区、窗口底色、原生控件配色 */
function applyShellTheme(next) {
  theme = next === 'dark' ? 'dark' : 'light';
  const c = palette();

  // 让原生控件（滚动条、右键菜单、下拉框）也跟随
  nativeTheme.themeSource = c.source;

  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(c.bg);
    // setTitleBarOverlay 在部分平台/版本上不可用，失败也不该影响主流程
    win.setTitleBarOverlay?.({ color: c.chrome, symbolColor: c.symbol, height: TOPBAR_H });
  }
}

/* --------------------------------------------------------------- 后端服务 */

/**
 * 决定数据目录放哪。
 *
 * 1. 显式设了 QQBOT_DATA_DIR 就用它（最高优先级）。
 * 2. 未打包、且项目里已经有 data/ —— 说明是开发/共存场景，直接共用那一份，
 *    这样命令行版和桌面版切来切去不会各自为政、配置凭空消失。
 * 3. 其它情况（也就是打包安装后）放 userData：
 *    Windows %APPDATA%\Q-Link、macOS ~/Library/Application Support/Q-Link。
 *    这是唯一可靠的写法 —— 程序目录在 asar 里是只读的。
 */
function resolveDataDir() {
  if (process.env.QQBOT_DATA_DIR) return process.env.QQBOT_DATA_DIR;
  const projectData = path.join(ROOT, 'data');
  if (!app.isPackaged && fs.existsSync(projectData)) return projectData;
  return path.join(app.getPath('userData'), 'data');
}

async function bootServer() {
  // 必须放在 import 之前：server/paths.js 在模块加载时就会读这个变量
  const dataDir = resolveDataDir();
  process.env.QQBOT_DATA_DIR = dataDir;
  process.env.QQBOT_HOST = '127.0.0.1';
  fs.mkdirSync(dataDir, { recursive: true });

  // 用 pathToFileURL：Windows 上手拼 `file://D:/...` 会把盘符当成主机名，导入会失败
  const entry = pathToFileURL(path.join(ROOT, 'server', 'index.js')).href;
  const { startServer } = await import(entry);

  const options = {
    host: '127.0.0.1',
    // 打包后 public/ 在只读的 asar 里，不能重建页面，直接用构建好的产物
    build: !app.isPackaged,
    quiet: true,
  };

  try {
    return await startServer({ ...options, port: PREFERRED_PORT });
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') throw err;
    // 端口被占（比如命令行版正在跑），退到系统分配的空闲端口
    console.warn(`[Q-Link] 端口 ${PREFERRED_PORT} 被占用，改用随机端口`);
    return startServer({ ...options, port: 0 });
  }
}

/* ----------------------------------------------------------------- 窗口 */

function createWindow() {
  const c = palette();

  // 按可用工作区算尺寸：写死 1380x920 在 125% 缩放的 1080p 屏上会被系统裁掉一截
  const { workAreaSize } = screen.getPrimaryDisplay();
  const width = Math.max(960, Math.min(1380, Math.round(workAreaSize.width * 0.92)));
  const height = Math.max(620, Math.min(920, Math.round(workAreaSize.height * 0.92)));

  win = new BrowserWindow({
    width,
    height,
    minWidth: 980,
    minHeight: 640,
    show: false, // 等首屏渲染好再显示，避免白闪
    backgroundColor: c.bg,
    autoHideMenuBar: true,
    title: 'Q-Link',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: c.chrome, symbolColor: c.symbol, height: TOPBAR_H },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  log('窗口尺寸', `${width}x${height}`, '工作区', JSON.stringify(workAreaSize));

  // 把主题通过 ?theme= 传给页面，首屏就是正确配色（页面自己也支持这个参数）
  const url = new URL(serverInfo.url);
  url.searchParams.set('theme', theme);
  win.loadURL(url.href);

  win.once('ready-to-show', () => win.show());

  // 站内所有外链交给系统浏览器，不要在窗口里开新窗口
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) {
      shell.openExternal(target);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 阻止把窗口本身导航到站外
  win.webContents.on('will-navigate', (event, target) => {
    if (!serverInfo || target.startsWith(serverInfo.url)) return;
    event.preventDefault();
    if (/^https?:/i.test(target)) shell.openExternal(target);
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

/* ------------------------------------------------------------------ 托盘 */

function trayImage() {
  const file = path.join(__dirname, 'assets', 'tray.png');
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? nativeImage.createEmpty() : img;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '显示 Q-Link 窗口',
      click: () => {
        if (!win || win.isDestroyed()) createWindow();
        else {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '打开数据目录',
      click: () => shell.openPath(app.getPath('userData')),
    },
    { type: 'separator' },
    {
      label: '退出 Q-Link（机器人会下线）',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const img = trayImage();
  if (img.isEmpty()) return; // 没有图标就不建托盘，不影响主功能
  tray = new Tray(img);
  tray.setToolTip('Q-Link — QQ 机器人控制台');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => {
    if (!win || win.isDestroyed()) createWindow();
    else if (win.isVisible()) win.hide();
    else win.show();
  });
}

/* ------------------------------------------------------------------ 生命周期 */

// 单实例：重复启动时聚焦已有窗口，避免两个进程抢同一个端口
if (!app.requestSingleInstanceLock()) {
  log('单实例锁没拿到，退出（可能已有一个 Q-Link 在运行）');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('检测到第二次启动，聚焦已有窗口');
    if (!win || win.isDestroyed()) createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    log('=== Q-Link 桌面版启动 ===', 'packaged=', String(app.isPackaged), 'electron=', process.versions.electron);
    theme = readSettings().theme === 'dark' ? 'dark' : 'light';
    nativeTheme.themeSource = palette().source;
    log('初始主题', theme, 'userData=', app.getPath('userData'));

    try {
      serverInfo = await bootServer();
      log('后端已启动', serverInfo.url, '数据目录=', process.env.QQBOT_DATA_DIR);
    } catch (err) {
      log('后端启动失败', err);
      dialog.showErrorBox('Q-Link 启动失败', `后端服务没能启动：\n\n${err?.message || err}`);
      app.exit(1);
      return;
    }

    createWindow();
    createTray();
    log('窗口与托盘已创建');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  ipcMain.on('qlink:theme', (_event, next) => {
    if (next !== 'light' && next !== 'dark') return;
    if (next === theme) return;
    log('主题切换为', next);
    applyShellTheme(next);
    writeSettings({ theme: next });
  });

  ipcMain.handle('qlink:info', () => ({
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    port: serverInfo?.port ?? null,
    theme,
  }));

  // 关掉窗口不退出：机器人留在后台跑（这正是桌面版相对命令行的好处）
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') return;
    if (quitting) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
  });
}
