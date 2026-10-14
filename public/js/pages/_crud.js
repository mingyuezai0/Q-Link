import { api } from '../api.js';
import { el, icon, mount, clear, toast, confirmDialog, field, switchField, debounce } from '../ui.js';

/**
 * QQ 风格的「列表 + 详情」双栏页面工厂。
 * 左侧是像联系人列表一样的条目列表，右侧是编辑表单 —— 与服务端保持 CRUD 同步。
 *
 * options:
 *   endpoint        /api/keywords
 *   pageTitle/pageSubtitle
 *   paneTitle       左侧面板标题
 *   noun            条目名词，用于文案（"关键词"）
 *   iconName        空状态的图标
 *   emptyTitle/emptyText
 *   searchPlaceholder
 *   primary(item)   列表主标题
 *   secondary(item) 列表副标题
 *   badge(item)     列表右侧徽标（可选，返回节点数组）
 *   enabledOf(item) 条目是否启用（用于灰显）
 *   blank()         新建条目的初始对象
 *   form(draft, h)  返回表单节点数组；h 提供绑定助手
 *   afterSave(item, draft) 保存后本地更新（可选）
 */
export function crudPage(options) {
  const {
    endpoint,
    pageTitle,
    pageSubtitle,
    paneTitle,
    noun = '条目',
    iconName = 'list',
    emptyTitle = `还没有${noun}`,
    emptyText = `添加第一条${noun}，机器人就会按你的设定来回应。`,
    searchPlaceholder = '搜索',
    primary = (item) => item.name || item.term || item.word || item.trigger || '未命名',
    secondary = () => '',
    badge = null,
    searchText = (item) => JSON.stringify(item),
    blank = () => ({}),
    form,
    afterSave,
  } = options;

  return async function render(host, ctx) {
    let items = [];
    let selectedId = null;
    let draft = null;
    let query = '';

    const listScroll = el('div', { class: 'list-scroll' });
    const countLabel = el('span', { class: 'count' }, '');
    const detailHost = el('div', { class: 'detail-pane' });
    const searchInput = el('input', {
      class: 'input',
      type: 'search',
      placeholder: searchPlaceholder,
      oninput: debounce((e) => {
        query = e.target.value.trim().toLowerCase();
        renderList();
      }, 140),
    });

    const listPane = el(
      'div',
      { class: 'list-pane' },
      el(
        'div',
        { class: 'list-pane-head' },
        el('span', { class: 'flex-1', style: 'font-weight:600' }, paneTitle),
        countLabel,
        el(
          'button',
          { class: 'btn btn-primary btn-sm', type: 'button', title: `新建${noun}`, onclick: create },
          icon('plus', 13),
          '新建',
        ),
      ),
      el('div', { style: 'padding:8px 10px 0' }, searchInput),
      listScroll,
    );

    const layout = el('div', { class: 'split' }, listPane, detailHost);

    mount(
      host,
      el(
        'div',
        { class: 'page-head' },
        el('h1', {}, pageTitle),
        pageSubtitle ? el('p', {}, pageSubtitle) : null,
      ),
      layout,
    );

    /* ---------------------------------------------------------- 数据加载 */

    async function load() {
      items = await api.get(endpoint);
      if (selectedId && !items.some((i) => i.id === selectedId)) selectedId = null;
      if (!selectedId && items.length) selectedId = items[0].id;
      renderList();
      renderDetail();
    }

    function filtered() {
      if (!query) return items;
      return items.filter((item) => String(searchText(item)).toLowerCase().includes(query));
    }

    function renderList() {
      const visible = filtered();
      countLabel.textContent = query ? `${visible.length}/${items.length}` : String(items.length);
      clear(listScroll);

      if (!visible.length) {
        listScroll.append(
          el(
            'div',
            { class: 'empty', style: 'padding:34px 16px' },
            el('h3', {}, query ? `没有匹配的${noun}` : emptyTitle),
            el('p', {}, query ? '换个词再试试。' : emptyText),
          ),
        );
        return;
      }

      for (const item of visible) {
        const isSelected = item.id === selectedId;
        const disabled = item.enabled === false;
        listScroll.append(
          el(
            'div',
            {
              class: 'list-item',
              role: 'option',
              tabindex: '0',
              'aria-selected': String(isSelected),
              style: disabled ? 'opacity:.55' : null,
              onclick: () => select(item.id),
              onkeydown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  select(item.id);
                }
              },
            },
            el(
              'div',
              { class: 'li-main' },
              el('div', { class: 'li-title' }, primary(item) || `未命名${noun}`),
              secondary(item) ? el('div', { class: 'li-sub' }, secondary(item)) : null,
            ),
            badge ? el('div', { class: 'li-side' }, badge(item)) : null,
          ),
        );
      }
    }

    function select(id) {
      if (id === selectedId) return;
      selectedId = id;
      renderList();
      renderDetail();
    }

    function renderDetail() {
      clear(detailHost);
      const item = items.find((i) => i.id === selectedId);
      if (!item) {
        detailHost.append(
          el(
            'div',
            { class: 'card' },
            el(
              'div',
              { class: 'empty' },
              el('div', { class: 'ico' }, icon(iconName, 34)),
              el('h3', {}, items.length ? `从左侧选择一个${noun}` : emptyTitle),
              el('p', {}, items.length ? '右侧会显示它的具体设置。' : emptyText),
              el('button', { class: 'btn btn-primary', type: 'button', onclick: create }, icon('plus', 14), `新建${noun}`),
            ),
          ),
        );
        return;
      }

      draft = structuredClone(item);
      const formNodes = form(draft, helpers);

      detailHost.append(
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'card-head' },
            el('h2', {}, primary(item) || `未命名${noun}`),
            item.enabled === false ? el('span', { class: 'tag' }, '已停用') : el('span', { class: 'tag green' }, '生效中'),
          ),
          el('div', { class: 'card-body' }, formNodes),
          el(
            'div',
            { class: 'card-foot' },
            el('button', { class: 'btn btn-primary', type: 'button', onclick: save }, icon('save', 14), '保存'),
            el('button', { class: 'btn', type: 'button', onclick: () => renderDetail() }, '放弃修改'),
            el('span', { class: 'spacer' }),
            el(
              'button',
              { class: 'btn btn-danger', type: 'button', onclick: remove },
              icon('trash', 14),
              '删除',
            ),
          ),
        ),
      );
    }

    /* -------------------------------------------------------------- 操作 */

    async function save() {
      try {
        const saved = await api.put(`${endpoint}/${selectedId}`, draft);
        const index = items.findIndex((i) => i.id === selectedId);
        if (index !== -1) items[index] = { ...items[index], ...saved };
        afterSave?.(items[index], draft);
        renderList();
        renderDetail();
        toast(`${noun}已保存`, 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    async function create() {
      try {
        const item = await api.post(endpoint, blank());
        items.unshift(item);
        selectedId = item.id;
        query = '';
        searchInput.value = '';
        renderList();
        renderDetail();
        toast(`已新建${noun}`, 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    async function remove() {
      const item = items.find((i) => i.id === selectedId);
      if (!item) return;
      const ok = await confirmDialog({
        title: `删除这个${noun}？`,
        message: `「${primary(item)}」将被永久删除，此操作无法撤销。`,
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`${endpoint}/${selectedId}`);
        items = items.filter((i) => i.id !== selectedId);
        selectedId = items[0]?.id || null;
        renderList();
        renderDetail();
        toast(`已删除${noun}`, 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    /* ------------------------------------------------------------ 绑定助手 */

    function bind(node, key, transform = (v) => v, event = 'input') {
      node.addEventListener(event, () => {
        draft[key] = transform(node.type === 'checkbox' ? node.checked : node.value);
      });
      return node;
    }

    const helpers = {
      draft,
      item: () => items.find((i) => i.id === selectedId),
      field,
      input(key, props = {}) {
        const node = el('input', { class: 'input', value: draft[key] ?? '', ...props });
        return bind(node, key);
      },
      textarea(key, props = {}) {
        const node = el('textarea', { class: 'textarea', ...props });
        node.value = draft[key] ?? '';
        return bind(node, key);
      },
      number(key, props = {}) {
        const node = el('input', { class: 'input', type: 'number', value: draft[key] ?? 0, ...props });
        return bind(node, key, (v) => (v === '' ? 0 : Number(v)));
      },
      select(key, choices, props = {}) {
        const node = el(
          'select',
          { class: 'select', ...props },
          ...choices.map((c) =>
            el('option', { value: c.value, selected: String(draft[key]) === String(c.value) }, c.label),
          ),
        );
        return bind(node, key, (v) => v, 'change');
      },
      toggle(key, label, props = {}) {
        return switchField(label, draft[key] !== false, (checked) => {
          draft[key] = checked;
        }, props);
      },
      tags(key, props = {}) {
        const node = el('input', {
          class: 'input',
          placeholder: '用逗号或空格分隔',
          value: Array.isArray(draft[key]) ? draft[key].join('、') : draft[key] || '',
          ...props,
        });
        return bind(node, key, (v) =>
          String(v)
            .split(/[,，、\s]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        );
      },
      rerender: renderDetail,
    };

    await load();
    return () => {};
  };
}
