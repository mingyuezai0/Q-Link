import { api } from './api.js';
import { el, icon, mount, toast, clear, openModal, countdownConfirm, field } from './ui.js';

import overview from './pages/overview.js';
import connect from './pages/connect.js';
import persona from './pages/persona.js';
import memory from './pages/memory.js';
import keywords from './pages/keywords.js';
import lists from './pages/lists.js';
import banned from './pages/banned.js';
import stickers from './pages/stickers.js';
import memes from './pages/memes.js';
import model from './pages/model.js';
import logs from './pages/logs.js';
import docs from './pages/docs.js';

/* ------------------------------------------------------------------ 路由 */

export const NAV = [
  { group: '接入', items: [{ id: 'overview', label: '概览', ico: 'home' }, { id: 'connect', label: '接入配置', ico: 'plug' }] },
  {
    group: '调教',
    items: [
      { id: 'persona', label: 'AI 人设', ico: 'user' },
      { id: 'memory', label: '记忆库', ico: 'brain', count: 'memories' },
      { id: 'keywords', label: '关键词', ico: 'key', count: 'keywords' },
      { id: 'lists', label: '名单表', ico: 'shield', count: 'lists' },
      { id: 'banned', label: '违禁词', ico: 'ban', count: 'banned' },
      { id: 'stickers', label: '表情包', ico: 'image', count: 'stickers' },
      { id: 'memes', label: '梗知识', ico: 'spark', count: 'memes' },
    ],
  },
  {
    group: '运行',
    items: [
      { id: 'model', label: 'AI 模型', ico: 'cpu' },
      { id: 'logs', label: '消息日志', ico: 'list' },
      { id: 'docs', label: '文档', ico: 'book' },
    ],
  },
];

const PAGES = { overview, connect, persona, memory, keywords, lists, banned, stickers, memes, model, logs, docs };

export const app = {
  status: { state: 'offline', text: '未连接', appId: '', sandbox: false, since: 0, error: '' },
  stats: { memories: 0, keywords: 0, banned: 0, stickers: 0, memes: 0, whitelist: 0, blacklist: 0, messages: 0, peers: 0, conversations: 0, identities: 0 },
  config: null,
  persona: null,
  bots: [],
  activeBotId: '',
  ws: null,
  current: null,
  el: {
    main: document.getElementById('main'),
    sidebar: document.getElementById('sidebar'),
    statusPill: document.getElementById('statusPill'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    envTag: document.getElementById('envTag'),
    btnToggle: document.getElementById('btnToggle'),
    btnRestart: document.getElementById('btnRestart'),
  },
};

/** 当前机器人档案 */
export function activeBot() {
  return app.bots.find((b) => b.id === app.activeBotId) || app.bots[0] || null;
}

let cleanup = null;

/* ------------------------------------------------------------------ 导航 */

function buildNav() {
  const nav = app.el.sidebar;
  clear(nav);

  const scroll = el('div', { class: 'nav-scroll' });
  for (const group of NAV) {
    scroll.append(
      el(
        'div',
        { class: 'nav-group' },
        el('div', { class: 'nav-group-title' }, group.group),
        ...group.items.map((item) =>
          el(
            'button',
            {
              class: 'nav-item',
              type: 'button',
              dataset: { page: item.id },
              onclick: () => {
                location.hash = `#/${item.id}`;
              },
            },
            el('span', { class: 'ico' }, icon(item.ico, 15)),
            el('span', { class: 'label' }, item.label),
            item.count ? el('span', { class: 'count', dataset: { count: item.count } }, '0') : null,
          ),
        ),
      ),
    );
  }

  nav.append(scroll, el('div', { class: 'bot-switch', id: 'botSwitch' }));
  syncCounts();
  renderBotSwitcher();
}

export function syncCounts() {
  for (const node of app.el.sidebar.querySelectorAll('[data-count]')) {
    const key = node.dataset.count;
    const value = key === 'lists' ? (app.stats.whitelist || 0) + (app.stats.blacklist || 0) : app.stats[key];
    node.textContent = value ? String(value) : '';
  }
}

/* ------------------------------------------------- 左下角：当前机器人 */

export function botAvatarNode(bot, size = 30) {
  const node = el('div', { class: 'avatar', style: `width:${size}px;height:${size}px` });
  const src = bot?.avatar || '';
  if (src) node.append(el('img', { src, alt: bot?.name || '' }));
  else node.textContent = String(bot?.name || 'Q').slice(0, 1).toUpperCase();
  return node;
}

function renderBotSwitcher() {
  const host = document.getElementById('botSwitch');
  if (!host) return;
  clear(host);

  const bot = activeBot();
  if (!bot) {
    host.append(el('div', { class: 'small muted', style: 'padding:8px' }, '还没有机器人'));
    return;
  }

  const bound = Boolean(bot.appIdHint);
  host.append(
    el(
      'button',
      {
        class: 'bot-card',
        type: 'button',
        title: '切换 / 管理机器人',
        onclick: openBotManager,
      },
      botAvatarNode(bot, 34),
      el(
        'span',
        { class: 'bot-card-main' },
        el('b', { class: 'truncate' }, bot.name || '未命名机器人'),
        el('i', { class: bound ? 'ok' : '' }, bound ? `已接入 ${bot.appIdHint}` : '未接入'),
      ),
      el('span', { class: 'bot-card-arrow' }, icon('chevron', 14)),
    ),
  );
}

/** 机器人管理弹窗：切换 / 新建 / 改名换头像 / 删除 */
export function openBotManager() {
  const list = el('div', { class: 'bot-list' });

  const draw = () => {
    clear(list);
    for (const bot of app.bots) {
      const isActive = bot.id === app.activeBotId;
      list.append(
        el(
          'div',
          { class: `bot-row${isActive ? ' active' : ''}` },
          botAvatarNode(bot, 38),
          el(
            'div',
            { class: 'bot-row-main' },
            el('b', {}, bot.name || '未命名机器人'),
            el(
              'span',
              { class: 'small muted' },
              bot.appIdHint ? `AppID ${bot.appIdHint}` : '未接入凭据',
              bot.source === 'qr' ? ' · 扫码接入' : '',
              isActive ? ' · 当前使用中' : '',
            ),
          ),
          el(
            'div',
            { class: 'bot-row-actions' },
            isActive
              ? el('span', { class: 'tag green' }, '使用中')
              : el(
                  'button',
                  {
                    class: 'btn btn-sm btn-primary',
                    type: 'button',
                    onclick: async () => {
                      try {
                        await api.post(`/api/bots/${bot.id}/activate`);
                        handle.close();
                        await loadBots();
                        await refresh();
                        toast(`已切换到「${bot.name}」`, 'ok');
                      } catch (err) {
                        toast(err.message, 'error');
                      }
                    },
                  },
                  '切换',
                ),
            el(
              'button',
              {
                class: 'btn btn-sm btn-ghost btn-danger',
                type: 'button',
                title: '删除',
                onclick: async () => {
                  const yes = await countdownConfirm({
                    title: `删除「${bot.name}」？`,
                    message: `这台机器人的全部配置都会被删除，且无法撤销：\n· 登录凭据（AppID / AppSecret）\n· AI 人设、记忆、关键词\n· 名单表、违禁词、表情包、梗知识\n· 全部会话上下文与消息日志`,
                    confirmText: '确认删除',
                    seconds: 5,
                  });
                  if (!yes) return;
                  try {
                    await api.del(`/api/bots/${bot.id}`);
                    await loadBots();
                    draw();
                    await refresh();
                    toast('已删除', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('trash', 13),
            ),
          ),
        ),
      );
    }
  };
  draw();

  const handle = openModal({
    title: '我的机器人',
    body: el('div', {}, list),
    footer: [
      el(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: async () => {
            try {
              const r = await api.post('/api/bots', { name: '新机器人' });
              await loadBots();
              draw();
              toast('已新建，切换过去即可单独配置', 'ok');
            } catch (err) {
              toast(err.message, 'error');
            }
          },
        },
        icon('plus', 13),
        '新建机器人',
      ),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => handle.close() }, '完成'),
    ],
  });
}

export async function loadBots() {
  const data = await api.get('/api/bots');
  app.bots = data.bots || [];
  app.activeBotId = data.activeId || app.bots[0]?.id || '';
  renderBotSwitcher();
  renderBrandAvatar();
}

export function renderBrandAvatar() {
  syncCounts();
  renderBotSwitcher();
}

function highlight(id) {
  for (const node of app.el.sidebar.querySelectorAll('.nav-item')) {
    if (node.dataset.page === id) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }
}

/* ------------------------------------------------------------------ 路由 */

function parseHash() {
  const id = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return PAGES[id] ? id : 'overview';
}

export async function navigate() {
  const id = parseHash();
  app.current = id;
  highlight(id);
  cleanup?.();
  cleanup = null;

  const main = app.el.main;
  clear(main);
  main.scrollTop = 0;

  const host = el('div', { class: 'page' });
  main.append(host);

  try {
    const result = await PAGES[id].render?.(host, { app, refresh });
    if (typeof result === 'function') cleanup = result;
    else if (result?.destroy) cleanup = result.destroy;
  } catch (err) {
    mount(host, el('div', { class: 'notice danger' }, icon('alert'), el('span', {}, `页面加载失败：${err.message}`)));
    toast(err.message, 'error');
  }
}

/** 重新拉取服务端状态并刷新当前页 */
export async function refresh({ silent = true } = {}) {
  await loadState(silent);
  await navigate();
}

export async function loadState(silent = true) {
  try {
    const [status, stats, config] = await Promise.all([
      api.get('/api/status'),
      api.get('/api/stats'),
      api.get('/api/config'),
    ]);
    applyStatus(status);
    app.stats = stats;
    app.config = config;
    syncCounts();
  } catch (err) {
    if (!silent) toast(`无法连接控制台服务：${err.message}`, 'error');
  }
}

/* ------------------------------------------------------------------ 主题 */

const THEME_KEY = 'qlink-theme';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function renderThemeButton() {
  const btn = document.getElementById('btnTheme');
  if (!btn) return;
  const dark = currentTheme() === 'dark';
  clear(btn);
  // 显示的是"点了会变成什么"，而不是当前状态
  btn.append(icon(dark ? 'sun' : 'moon', 14), dark ? '白天模式' : '黑夜模式');
  btn.title = dark ? '切换到白天模式' : '切换到黑夜模式';
}

export function setTheme(mode, { persist = true } = {}) {
  const dark = mode === 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      /* 隐私模式下写不进去也无所谓 */
    }
  }
  renderThemeButton();
  // 桌面外壳（Electron）需要同步窗口边框与标题栏按钮的配色
  window.qlink?.setTheme?.(dark ? 'dark' : 'light');
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  toast(next === 'dark' ? '已切换到黑夜模式' : '已切换到白天模式', 'info', 1600);
}

/* ------------------------------------------------------------------ 开屏 */

const SPLASH_MIN_MS = 950;

function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.dataset.done) return;
  splash.dataset.done = '1';
  const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
  setTimeout(() => {
    splash.classList.add('hiding');
    setTimeout(() => splash.classList.add('gone'), 480);
  }, wait);
}

/* ------------------------------------------------------------------ 状态 */

export function applyStatus(status) {
  app.status = { ...app.status, ...status };
  const map = { online: '在线', connecting: '连接中…', error: '连接异常', offline: '未连接' };
  const state = app.status.state || 'offline';
  app.el.statusPill.dataset.state = state;
  app.el.statusText.textContent = app.status.detail || map[state] || '未连接';
  app.el.statusPill.title = app.status.error || map[state];
  app.el.envTag.hidden = !app.status.sandbox;
  app.el.btnToggle.textContent = state === 'online' || state === 'connecting' ? '停止机器人' : '启动机器人';
  app.el.btnToggle.classList.toggle('btn-primary', !(state === 'online' || state === 'connecting'));
}

/* ----------------------------------------------------------- 实时通道 */

function openSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${proto}://${location.host}/ws`);
  app.ws = socket;

  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    const detail = { type: data.type, payload: data.payload, at: data.at };
    window.dispatchEvent(new CustomEvent('console:event', { detail }));

    if (data.type === 'status') applyStatus(data.payload);
    if (data.type === 'stats') {
      app.stats = data.payload;
      syncCounts();
    }
    if (data.type === 'bots:changed') {
      // 扫码绑定了新机器人、或在别处切换了机器人：整页跟着换一套配置
      loadBots()
        .then(() => refresh())
        .catch(() => {});
    }
    if (data.type === 'config:changed' && app.current === 'connect') {
      refresh().catch(() => {});
    }
  };

  socket.onclose = () => {
    app.ws = null;
    setTimeout(openSocket, 2000);
  };
  socket.onerror = () => socket.close();
}

/* --------------------------------------------------- 顶栏按钮：启动/停止 */

async function toggleBot() {
  const running = app.status.state === 'online' || app.status.state === 'connecting';
  app.el.btnToggle.disabled = true;
  try {
    const result = running ? await api.post('/api/bot/stop') : await api.post('/api/bot/start');
    applyStatus(result.status || {});
    toast(running ? '已停止机器人' : '正在启动机器人…', running ? 'info' : 'ok');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    app.el.btnToggle.disabled = false;
  }
}

async function restartBot() {
  app.el.btnRestart.disabled = true;
  try {
    const result = await api.post('/api/bot/restart');
    applyStatus(result.status || {});
    toast('已重启连接', 'ok');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    app.el.btnRestart.disabled = false;
  }
}

/* ------------------------------------------------------------------ 启动 */

/**
 * 直接双击 console.html 打开时，页面是 file:// 协议，
 * 不可能连上本机的控制台服务。这里给一句明确的指引，而不是白屏。
 */
function renderFileProtocolNotice() {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  box.setAttribute(
    'style',
    'max-width:560px;margin:14vh auto;padding:28px 30px;font:14px/1.75 "PingFang SC","Microsoft YaHei UI",system-ui,sans-serif;color:#1a1a1a;background:#fff;border:1px solid #e7e7e7;border-radius:12px;box-shadow:0 12px 40px rgba(16,34,51,.16)',
  );
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <span style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#3fc7ff,#0084e8);display:grid;place-items:center;color:#fff;font-weight:600">Q</span>
      <b style="font-size:16px">Q-Link</b>
    </div>
    <p style="margin:0 0 12px">这个页面需要配合本机的控制台服务一起运行，所以不能直接双击打开。</p>
    <p style="margin:0 0 6px;font-weight:600">请改用下面任意一种方式：</p>
    <ol style="margin:0;padding-left:22px;color:#5c5c5c">
      <li>双击项目里的「启动控制台.bat」（或 <code>启动控制台.command</code>）</li>
      <li>或者在项目目录执行 <code>npm start</code>，然后打开 <b>http://127.0.0.1:3200</b></li>
    </ol>
    <p style="margin:16px 0 0;color:#9a9a9a;font-size:12.5px">启动后请访问 http://127.0.0.1:3200 ，不要用文件路径打开。</p>
  `;
  document.body.append(box);
}

async function boot() {
  if (location.protocol === 'file:') {
    document.getElementById('splash')?.classList.add('gone');
    renderFileProtocolNotice();
    return;
  }

  buildNav();
  renderThemeButton();
  document.getElementById('btnTheme')?.addEventListener('click', toggleTheme);

  // 跑在桌面外壳里时，让顶栏变成窗口拖拽区，并把当前主题同步给外壳
  if (window.qlink?.desktop) {
    document.body.classList.add('is-desktop');
    setTheme(currentTheme(), { persist: false });
  }

  await loadState(false);
  await loadBots().catch(() => {});
  try {
    app.persona = await api.get('/api/persona');
  } catch {
    /* 首次运行时允许失败 */
  }

  app.el.btnToggle.addEventListener('click', toggleBot);
  app.el.btnRestart.addEventListener('click', restartBot);
  app.el.statusPill.addEventListener('click', () => {
    location.hash = '#/connect';
  });
  window.addEventListener('hashchange', navigate);

  openSocket();
  await navigate();

  // 首屏渲染完成，收起开屏动画
  hideSplash();

  // 首次进入时给一句引导，避免空白感
  if (!app.config?.appId) {
    setTimeout(() => toast('还没有接入机器人，先去「接入配置」扫码或填写 AppID', 'info', 4200), 700);
  }
}

// 兜底：万一初始化卡住，开屏也不能一直挡着
setTimeout(hideSplash, 4000);

boot();
