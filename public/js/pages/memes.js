import { crudPage } from './_crud.js';
import { el, field } from '../ui.js';

export default {
  render: crudPage({
    endpoint: '/api/memes',
    pageTitle: '梗知识',
    paneTitle: '梗词条',
    noun: '梗',
    iconName: 'spark',
    searchPlaceholder: '搜索梗或含义',
    emptyTitle: '还没有梗词条',
    emptyText: '加一条试试，例如「绝绝子」→ 表达极度赞美的网络流行语。',
    primary: (item) => item.term || '未命名梗',
    secondary: (item) => item.meaning || '',
    searchText: (item) => `${item.term} ${(item.alias || []).join(' ')} ${item.meaning}`,
    badge: (item) => [
      ...(item.tags || []).slice(0, 2).map((t) => el('span', { class: 'tag' }, t)),
      item.hits ? el('span', { class: 'tag blue mono' }, `${item.hits} 次`) : null,
    ].filter(Boolean),
    blank: () => ({ term: '', alias: [], meaning: '', usage: '', tags: [], enabled: true }),
    form: (draft, h) => [
      el(
        'div',
        { class: 'row' },
        el('div', {}, field('梗 / 说法', h.input('term', { placeholder: '例如：绝绝子' }))),
        el('div', {}, field('别名', h.tags('alias', { placeholder: '同义说法，逗号分隔' }), '命中任意一个别名都会注入。')),
      ),
      field('含义', h.textarea('meaning', { class: 'textarea', placeholder: '例如：表达极度赞美或无语，语气偏夸张' }), '模型理解这个梗的依据，写得越具体越好。'),
      field('使用场景 / 例句', h.textarea('usage', { class: 'textarea', placeholder: '例如：夸人时用，「这道菜绝绝子」' }), '可选，帮助模型判断什么时候该用。'),
      el(
        'div',
        { class: 'row' },
        el('div', {}, field('分类标签', h.tags('tags', { placeholder: '例如：网络流行语、群内黑话' }))),
        el('div', { style: 'padding-top:26px' }, h.toggle('enabled', '启用这条梗')),
      ),
      draft.hits ? el('div', { class: 'notice' }, el('span', {}, `已命中 ${draft.hits} 次。`)) : null,
    ].filter(Boolean),
  }),
};
