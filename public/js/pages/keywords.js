import { crudPage } from './_crud.js';
import { el, field, icon, debounce } from '../ui.js';

const MODE_LABEL = { recall: '唤起记忆', fixed: '固定回复', ai: '交给 AI', ignore: '忽略' };
const MODE_TONE = { recall: 'blue', fixed: 'green', ai: '', ignore: 'red' };

export default {
  render: crudPage({
    endpoint: '/api/keywords',
    pageTitle: '关键词',
    paneTitle: '关键词',
    noun: '关键词',
    iconName: 'key',
    searchPlaceholder: '搜索关键词或详情',
    emptyTitle: '还没有关键词记忆',
    emptyText: '加一条试试，例如关键词「生日礼物」，详情写「他想要一把机械键盘，预算 500 左右，生日 3 月 5 日」。',
    primary: (item) => item.trigger || '未设置关键词',
    secondary: (item) => {
      const text = String(item.detail || item.reply || '').replace(/\n/g, ' ');
      return text.length > 46 ? `${text.slice(0, 46)}…` : text || '（还没有写详情）';
    },
    searchText: (item) => `${item.trigger} ${(item.alias || []).join(' ')} ${item.detail} ${item.reply}`,
    badge: (item) => [
      el('span', { class: `tag ${MODE_TONE[item.mode] || ''}` }, MODE_LABEL[item.mode] || item.mode),
      item.source === 'auto' ? el('span', { class: 'tag amber' }, '自动') : null,
      item.hits ? el('span', { class: 'tag mono' }, `${item.hits} 次`) : null,
    ].filter(Boolean),
    blank: () => ({
      trigger: '',
      alias: [],
      matchType: 'contains',
      mode: 'recall',
      detail: '',
      reply: '',
      priority: 1,
      cooldown: 0,
      source: 'manual',
      enabled: true,
    }),
    form: (draft, h) => {
      /* 小工具：输入一句话，立刻看到它会不会命中这条关键词 */
      const tester = el('input', { class: 'input', placeholder: '输入一句话试试会不会命中…' });
      const testerOut = el('span', { class: 'tag' }, '等待输入');
      const words = el('div', { class: 'row-inline' });

      const refreshWords = () => {
        words.replaceChildren();
        const terms = [draft.trigger, ...(draft.alias || [])].filter(Boolean);
        if (!terms.length) {
          words.append(el('span', { class: 'small muted' }, '还没有设置触发词'));
          return;
        }
        for (const t of terms) words.append(el('span', { class: 'tag blue' }, t));
      };
      refreshWords();

      const runTest = debounce(() => {
        const text = tester.value.trim();
        if (!text) {
          testerOut.className = 'tag';
          testerOut.textContent = '等待输入';
          return;
        }
        const terms = [draft.trigger, ...(draft.alias || [])].filter(Boolean);
        let hit = false;
        for (const term of terms) {
          try {
            if (draft.matchType === 'regex') hit = new RegExp(term, 'i').test(text);
            else if (draft.matchType === 'exact') hit = text === term;
            else hit = text.toLowerCase().includes(String(term).toLowerCase());
          } catch {
            hit = false;
          }
          if (hit) break;
        }
        testerOut.className = `tag ${hit ? 'green' : ''}`;
        testerOut.textContent = hit ? '会命中，详情会被想起' : '不会命中';
      }, 160);
      tester.addEventListener('input', runTest);

      return [
        el(
          'div',
          { class: 'row' },
          el('div', {}, field('关键词', h.input('trigger', { placeholder: '例如：生日礼物' }))),
          el('div', {}, field('别名', h.tags('alias', { placeholder: '同义说法，逗号分隔' }), '提到任意一个都会想起这条。')),
        ),
        el('div', { class: 'mt-8', style: 'margin-bottom:14px' }, el('span', { class: 'label' }, '当前触发词'), words),

        el(
          'div',
          { class: 'row' },
          el('div', {}, field('匹配方式', h.select('matchType', [
            { value: 'contains', label: '包含即可' },
            { value: 'exact', label: '完全相等' },
            { value: 'regex', label: '正则表达式' },
          ]))),
          el('div', {}, field('优先级', h.number('priority', { min: -100, max: 100 }), '数字越大越优先。')),
        ),

        field(
          draft.mode === 'recall' ? '要记住的详情' : draft.mode === 'ai' ? '额外的 AI 要求' : '回复内容',
          h.textarea(draft.mode === 'recall' ? 'detail' : 'reply', {
            class: 'textarea tall',
            placeholder:
              draft.mode === 'recall'
                ? '例如：他想要一把机械键盘，预算 500 左右，生日是 3 月 5 日；不喜欢太吵的轴体。'
                : draft.mode === 'ai'
                  ? '例如：用三条以内的短句回答，不要用列表'
                  : '例如：收到啦，已经帮你记下了 ✅',
          }),
          draft.mode === 'recall'
            ? '这段详情不会直接发给用户，而是在提到关键词时作为背景交给模型，让它自然地用上。写得越具体越有用。'
            : '这段内容会原样发出。',
        ),

        el(
          'div',
          { class: 'row' },
          el('div', {}, field('命中后怎么处理', h.select('mode', [
            { value: 'recall', label: '唤起记忆，交给 AI 自然回应（推荐）' },
            { value: 'fixed', label: '直接回复下面这句话' },
            { value: 'ai', label: '作为一条额外要求交给 AI' },
            { value: 'ignore', label: '忽略这条消息，不回复' },
          ]))),
          el('div', { style: 'padding-top:26px' }, h.toggle('enabled', '启用这条关键词')),
        ),

        field('命中测试', el('div', { class: 'row-inline' }, el('span', { class: 'flex-1' }, tester), testerOut)),

        draft.mode === 'ignore'
          ? el('div', { class: 'notice warn' }, icon('alert', 14), el('span', {}, '「忽略」会完全不回复，但仍会记进会话上下文。'))
          : null,
      ].filter(Boolean);
    },
  }),
};
