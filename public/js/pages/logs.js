import { api } from '../api.js';
import { el, icon, mount, clear, toast, fullTime, timeAgo, confirmDialog, debounce } from '../ui.js';

const KIND_LABEL = { in: '收到', out: '回复', keyword: '关键词', blocked: '已拦截', error: '异常' };
const KIND_TONE = { in: '', out: 'blue', keyword: 'blue', blocked: 'red', error: 'red' };

export default {
  async render(host, ctx) {
    let conversations = await api.get('/api/conversations');
    let identities = await api.get('/api/identities');
    let selectedId = conversations[0]?.id || null;
    let detail = null;
    let query = '';
    const runtimeLines = [];

    const listHost = el('div', { class: 'list-scroll' });
    const threadHost = el('div', { class: 'thread-pane' });
    const searchInput = el('input', {
      class: 'input',
      type: 'search',
      placeholder: '搜索会话',
      // 必须限定宽度：.input 是 width:100%，放在 flex 行里会把标题挤到换行
      style: 'flex:0 0 auto;width:200px',
      oninput: debounce((e) => {
        query = e.target.value.trim().toLowerCase();
        renderList();
      }, 150),
    });

    const identityOf = (openid) => identities.find((i) => String(i.openid) === String(openid)) || null;

    /* ------------------------------------------------------- 会话列表 */

    function grouped() {
      const match = (c) => {
        if (!query) return true;
        const names = Object.values(c.members || {}).map((m) => m.name).join(' ');
        return `${c.name} ${c.targetId} ${names}`.toLowerCase().includes(query);
      };
      const list = conversations.filter(match);
      return { c2c: list.filter((c) => c.scope === 'c2c'), group: list.filter((c) => c.scope === 'group') };
    }

    function convTitle(conv) {
      if (conv.name && conv.name !== '私聊' && conv.name !== '未命名群聊') return conv.name;
      const members = Object.values(conv.members || {});
      if (conv.scope === 'c2c') {
        const m = members[0];
        return m?.name || identityOf(conv.targetId)?.name || `用户 ${String(conv.targetId).slice(0, 8)}`;
      }
      return `群 ${String(conv.targetId).slice(0, 8)}`;
    }

    function renderList() {
      const { c2c, group } = grouped();
      clear(listHost);

      if (!conversations.length) {
        listHost.append(
          el(
            'div',
            { class: 'empty', style: 'padding:34px 16px' },
            el('div', { class: 'ico' }, icon('list', 30)),
            el('h3', {}, '还没有对话'),
            el('p', {}, '机器人上线后，私聊与群聊会自动出现在这里。'),
          ),
        );
        return;
      }

      const section = (title, items, tone) => {
        if (!items.length) return null;
        return el(
          'div',
          { class: 'conv-section' },
          el('div', { class: 'conv-section-title' }, el('span', { class: `tag ${tone}` }, title), el('span', { class: 'muted small' }, `${items.length}`)),
          ...items.map((conv) =>
            el(
              'div',
              {
                class: 'list-item',
                role: 'option',
                tabindex: '0',
                'aria-selected': String(conv.id === selectedId),
                onclick: () => select(conv.id),
              },
              el('div', { class: `conv-face ${conv.scope}` }, conv.scope === 'group' ? '群' : '私'),
              el(
                'div',
                { class: 'li-main' },
                el('div', { class: 'li-title' }, convTitle(conv)),
                el('div', { class: 'li-sub' }, conv.lastText || '（暂无内容）'),
              ),
              el(
                'div',
                { class: 'li-side', style: 'flex-direction:column;align-items:flex-end' },
                el('span', { class: 'small muted mono-num' }, timeAgo(conv.lastAt)),
                el('span', { class: 'tag mono' }, `${(conv.counts?.in || 0) + (conv.counts?.out || 0)}`),
              ),
            ),
          ),
        );
      };

      const c2cNode = section('私聊', c2c, '');
      const groupNode = section('群聊', group, 'blue');
      if (!c2cNode && !groupNode) {
        listHost.append(el('div', { class: 'empty', style: 'padding:30px' }, el('p', {}, '没有匹配的会话。')));
        return;
      }
      listHost.append(...[c2cNode, groupNode].filter(Boolean));
    }

    async function select(id) {
      selectedId = id;
      renderList();
      await loadDetail();
    }

    async function loadDetail() {
      clear(threadHost);
      if (!selectedId) {
        threadHost.append(el('div', { class: 'empty' }, el('h3', {}, '从左边选一个会话'), el('p', {}, '右侧会显示完整的对话记录与对方信息。')));
        return;
      }
      try {
        detail = await api.get(`/api/conversations/${encodeURIComponent(selectedId)}/messages?limit=300`);
      } catch (err) {
        threadHost.append(el('div', { class: 'notice danger' }, icon('alert', 14), el('span', {}, err.message)));
        return;
      }
      renderThread();
    }

    /* --------------------------------------------------------- 会话详情 */

    function renderThread() {
      clear(threadHost);
      if (!detail) return;
      const conv = detail.conversation;
      const members = Object.values(conv.members || {});

      /* 会话头部 + 对方信息 */
      const infoBox = el('div', { class: 'peer-info' });
      const addPeerRow = (openid, label, extra) => {
        const id = identityOf(openid);
        const person = id?.listTag ? id : null;
        infoBox.append(
          el(
            'div',
            { class: 'peer-row' },
            el('div', { class: 'avatar', style: 'width:30px;height:30px' }, String(id?.name || extra || openid).slice(0, 1).toUpperCase()),
            el(
              'div',
              { class: 'flex-1' },
              el(
                'div',
                { class: 'row-inline' },
                el('b', {}, id?.name || extra || '（平台未提供昵称）'),
                person?.listTag === 'whitelist' ? el('span', { class: 'tag green' }, '白名单') : null,
                person?.listTag === 'blacklist' ? el('span', { class: 'tag red' }, '黑名单') : null,
              ),
              el('div', { class: 'mono-num small muted truncate', title: openid }, `${label}：${openid}`),
              el(
                'div',
                { class: 'small muted' },
                id ? `发过 ${id.count} 条 · 首次 ${timeAgo(id.firstAt)} · 最近 ${timeAgo(id.lastAt)}` : '暂无更多记录',
              ),
            ),
          ),
        );
      };

      if (conv.scope === 'c2c') {
        addPeerRow(conv.targetId, '单聊 openid');
      } else {
        infoBox.append(
          el('div', { class: 'small muted', style: 'margin-bottom:6px' }, `群 openid：${conv.targetId}`),
        );
        for (const m of members) addPeerRow(m.key, '群内 openid', m.name);
      }

      /* 消息流 */
      const stream = el('div', { class: 'msg-stream' });
      if (!detail.messages.length) {
        stream.append(el('div', { class: 'empty', style: 'padding:30px' }, el('p', {}, '这个会话还没有记录。')));
      }
      for (const msg of detail.messages) {
        const inbound = msg.kind === 'in';
        stream.append(
          el(
            'div',
            { class: `msg-bubble-row${inbound ? '' : ' out'}` },
            el(
              'div',
              { class: 'msg-bubble' },
              el(
                'div',
                { class: 'msg-meta' },
                el('b', {}, inbound ? msg.userName || '用户' : '机器人'),
                el('span', { class: `tag ${KIND_TONE[msg.kind] || ''}` }, KIND_LABEL[msg.kind] || msg.kind),
                msg.reason ? el('span', { class: 'tag amber' }, msg.reason) : null,
                el('span', { class: 'spacer' }),
                el('span', { class: 'mono-num', title: fullTime(msg.at) }, timeAgo(msg.at)),
              ),
              el('div', { class: 'msg-text' }, msg.text || '（空）'),
            ),
          ),
        );
      }

      const nameInput = el('input', { class: 'input', value: conv.name || '', placeholder: '给这个会话起个名字' });

      threadHost.append(
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'card-head' },
            el('h2', {}, convTitle(conv)),
            el('span', { class: `tag ${conv.scope === 'group' ? 'blue' : ''}` }, conv.scope === 'group' ? '群聊' : '私聊'),
            el('span', { class: 'hint' }, `收到 ${conv.counts?.in || 0} · 回复 ${conv.counts?.out || 0} · 首次 ${timeAgo(conv.firstAt)}`),
            el(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onclick: async () => {
                  const yes = await confirmDialog({
                    title: '清空这个会话？',
                    message: '会给这个会话里的每个人重置对话上下文，机器人不再记得之前聊过什么。历史日志会保留。',
                    confirmText: '清空上下文',
                    danger: true,
                  });
                  if (!yes) return;
                  try {
                    await api.del(`/api/conversations/${encodeURIComponent(conv.id)}`);
                    await ctx.refresh();
                    toast('已清空该会话上下文', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('trash', 13),
            ),
          ),
          el(
            'div',
            { class: 'card-body tight' },
            el('div', { class: 'peer-info-title' }, icon('user', 13), conv.scope === 'c2c' ? '对方信息' : `群里说过话的人（${members.length}）`),
            infoBox,
          ),
          stream,
          el(
            'div',
            { class: 'card-foot' },
            nameInput,
            el(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async (e) => {
                  e.target.disabled = true;
                  try {
                    await api.put(`/api/conversations/${encodeURIComponent(conv.id)}`, { name: nameInput.value });
                    const target = conversations.find((c) => c.id === conv.id);
                    if (target) target.name = nameInput.value;
                    renderList();
                    toast('已重命名', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  } finally {
                    e.target.disabled = false;
                  }
                },
              },
              '重命名',
            ),
          ),
        ),
      );
    }

    /* --------------------------------------------------------- 运行日志 */

    const runtimeStream = el('div', { class: 'log-stream' });
    function appendRuntime(entry) {
      runtimeLines.push(entry);
      if (runtimeLines.length > 300) runtimeLines.shift();
      runtimeStream.append(
        el(
          'div',
          { class: 'log-line', dataset: { level: entry.level || 'info' } },
          el('span', { class: 'ts' }, fullTime(entry.at).slice(11)),
          el('span', { class: 'lv' }, String(entry.level || 'info').toUpperCase().slice(0, 5)),
          el('span', { class: 'sc' }, entry.scope || ''),
          el('span', { class: 'ms' }, entry.message || ''),
        ),
      );
      while (runtimeStream.childElementCount > 300) runtimeStream.removeChild(runtimeStream.firstChild);
      runtimeStream.scrollTop = runtimeStream.scrollHeight;
    }

    /* ------------------------------------------------------------ 页面 */

    mount(
      host,
      el('div', { class: 'page-head' }, el('h1', {}, '消息日志')),

      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card-head' },
          el('h2', {}, '对话记录'),
          el('span', { class: 'hint' }, `${conversations.length} 个会话`),
          el('span', { class: 'spacer' }),
          searchInput,
          el(
            'button',
            {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: async () => {
                [conversations, identities] = await Promise.all([api.get('/api/conversations'), api.get('/api/identities')]);
                if (selectedId && !conversations.some((c) => c.id === selectedId)) selectedId = conversations[0]?.id || null;
                renderList();
                await loadDetail();
                toast('已刷新', 'ok');
              },
            },
            icon('refresh', 13),
            '刷新',
          ),
        ),
        el(
          'div',
          { class: 'card-body' },
          el('div', { class: 'conv-layout' }, el('div', { class: 'list-pane' }, listHost), threadHost),
        ),
      ),

      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card-head' },
          el('h2', {}, '运行日志'),
          el('span', { class: 'hint' }, '连接、鉴权、模型调用的实时输出'),
          el(
            'button',
            {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: () => {
                runtimeLines.length = 0;
                clear(runtimeStream);
              },
            },
            '清屏',
          ),
        ),
        runtimeStream,
      ),
    );

    renderList();
    await loadDetail();

    try {
      for (const entry of await api.get('/api/runtime-logs')) appendRuntime(entry);
    } catch {
      /* 忽略 */
    }

    const onEvent = (e) => {
      const { type, payload } = e.detail;
      if (type === 'log') appendRuntime({ ...payload, at: payload.at || Date.now() });
      if (type === 'message') {
        // 有新消息就刷新会话列表；若正是当前会话，顺便刷新消息流
        api.get('/api/conversations').then((list) => {
          conversations = list;
          renderList();
        }).catch(() => {});
        if (payload.scope && selectedId) loadDetail().catch(() => {});
      }
    };
    window.addEventListener('console:event', onEvent);
    return () => window.removeEventListener('console:event', onEvent);
  },
};
