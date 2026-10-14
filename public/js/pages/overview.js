import { api } from '../api.js';
import { el, icon, mount, clear, timeAgo, clockTime, fullTime, toast } from '../ui.js';
import { applyStatus } from '../app.js';

export default {
  async render(host, ctx) {
    const [status, stats, logs] = await Promise.all([
      api.get('/api/status'),
      api.get('/api/stats'),
      api.get('/api/logs?limit=12'),
    ]);
    applyStatus(status);

    const statCards = el('div', { class: 'grid grid-4' });
    const cards = [
      { k: '在线会话', v: stats.peers, icon: 'user' },
      { k: '记忆条目', v: stats.memories, icon: 'brain' },
      { k: '关键词', v: stats.keywords, icon: 'key' },
      { k: '名单表', v: (stats.whitelist || 0) + (stats.blacklist || 0), icon: 'shield' },
      { k: '表情包', v: stats.stickers, icon: 'image' },
      { k: '梗知识', v: stats.memes, icon: 'spark' },
      { k: '累计消息', v: stats.messages, icon: 'list' },
      { k: '模型', v: status.aiConfigured ? '已就绪' : '未配置', icon: 'cpu', accent: status.aiConfigured },
    ];
    for (const c of cards) {
      statCards.append(
        el(
          'div',
          { class: `stat${c.accent ? ' ok' : ''}` },
          el('div', { class: 'k' }, icon(c.icon, 13), c.k),
          el('div', { class: 'v' }, typeof c.v === 'number' ? String(c.v) : el('span', { style: 'font-size:15px' }, c.v)),
        ),
      );
    }

    /* -------------------------------------------------- 接入状态卡片 */

    const statusBody = el('div');

    function renderStatus(s) {
      clear(statusBody);
      const map = { online: ['green', '运行中'], connecting: ['blue', '连接中'], error: ['red', '连接异常'], offline: ['', '未启动'] };
      const [tone, label] = map[s.state] || map.offline;

      statusBody.append(
        el(
          'div',
          { class: 'row-inline', style: 'margin-bottom:12px' },
          el('span', { class: `tag ${tone}` }, label),
          s.sandbox ? el('span', { class: 'tag amber' }, '沙箱环境') : el('span', { class: 'tag' }, '正式环境'),
          s.bot?.username ? el('span', { class: 'tag blue' }, s.bot.username) : null,
        ),
      );

      const rows = [
        ['AppID', s.configured ? s.appId || '已配置' : '未配置'],
        ['接口域名', s.baseUrl],
        ['机器人昵称', s.bot?.username || '—'],
        ['当前状态', s.detail || label],
      ];
      statusBody.append(
        el(
          'table',
          { class: 'table' },
          el(
            'tbody',
            {},
            ...rows.map(([k, v]) =>
              el('tr', {}, el('td', { style: 'width:120px;color:var(--ink-2)' }, k), el('td', { class: 'mono' }, String(v))),
            ),
          ),
        ),
      );
      if (s.error) statusBody.append(el('div', { class: 'notice danger mt-12' }, icon('alert', 14), el('span', {}, s.error)));
    }

    renderStatus(status);

    /* -------------------------------------------------- 最近消息 */

    const messageList = el('div');
    const renderMessages = (list) => {
      clear(messageList);
      if (!list.length) {
        messageList.append(
          el(
            'div',
            { class: 'empty' },
            el('div', { class: 'ico' }, icon('send', 30)),
            el('h3', {}, '还没有消息'),
            el('p', {}, '机器人上线后，收到的每一条消息都会出现在这里。'),
            el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.refresh() }, '刷新'),
          ),
        );
        return;
      }
      for (const item of list) {
        const inbound = item.kind !== 'out';
        messageList.append(
          el(
            'div',
            { class: 'msg-row' },
            el('div', { class: 'face' }, inbound ? '收' : '发'),
            el(
              'div',
              { class: 'content' },
              el(
                'div',
                { class: 'who' },
                el('b', {}, item.userName || (inbound ? '用户' : '机器人')),
                el('span', { class: 'tag' }, item.scope === 'group' ? '群聊' : '单聊'),
                item.reason ? el('span', { class: 'tag blue' }, item.reason) : null,
                el('span', { class: 'muted mono-num small' }, clockTime(item.at)),
              ),
              el('div', { class: 'text' }, item.text || '（空）'),
            ),
          ),
        );
      }
    };
    renderMessages(logs);

    /* -------------------------------------------------- 页头 */

    mount(
      host,
      el('div', { class: 'page-head' }, el('h1', {}, '概览')),
      el('div', { style: 'margin-bottom:14px' }, statCards),
      el(
        'div',
        { class: 'grid grid-2' },
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'card-head' },
            el('h2', {}, '接入状态'),
            el('span', { class: 'hint' }, '数据来自 /api/status'),
          ),
          el('div', { class: 'card-body' }, statusBody),
          el(
            'div',
            { class: 'card-foot' },
            el(
              'button',
              {
                class: 'btn btn-primary',
                type: 'button',
                onclick: async () => {
                  try {
                    const r = await api.post('/api/bot/start');
                    applyStatus(r.status || {});
                    toast('正在启动机器人…', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('play', 13),
              '启动机器人',
            ),
            el('button', { class: 'btn', type: 'button', onclick: () => (location.hash = '#/connect') }, '接入配置'),
            el('span', { class: 'spacer' }),
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => ctx.refresh() }, icon('refresh', 13), '刷新'),
          ),
        ),
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'card-head' },
            el('h2', {}, '最近消息'),
            el('span', { class: 'hint' }, stats.messages ? `共 ${stats.messages} 条记录` : ''),
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => (location.hash = '#/logs') }, '查看全部'),
          ),
          el('div', { class: 'card-body tight' }, messageList),
        ),
      ),
    );

    /* 实时刷新最近消息 */
    const onEvent = async (e) => {
      const { type } = e.detail;
      if (type === 'message' || type === 'status') {
        try {
          const [s, l] = await Promise.all([api.get('/api/status'), api.get('/api/logs?limit=12')]);
          renderStatus(s);
          renderMessages(l);
        } catch {
          /* 忽略瞬时错误 */
        }
      }
    };
    window.addEventListener('console:event', onEvent);
    return () => window.removeEventListener('console:event', onEvent);
  },
};
