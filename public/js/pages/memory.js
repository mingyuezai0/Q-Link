import { crudPage } from './_crud.js';
import { el, field } from '../ui.js';

const SCOPE_LABEL = { global: '全局', user: '单聊用户', group: '群聊' };

export default {
  render: crudPage({
    endpoint: '/api/memories',
    pageTitle: '记忆库',
    paneTitle: '记忆条目',
    noun: '记忆',
    iconName: 'brain',
    searchPlaceholder: '搜索记忆内容',
    emptyTitle: '还没有记忆',
    emptyText: '手动添加一条，例如「称呼：老板」「偏好：不喜欢长篇大论」。',
    primary: (item) => item.key || '未命名记忆',
    secondary: (item) => item.value || '',
    searchText: (item) => `${item.key} ${item.value} ${item.target}`,
    badge: (item) => [
      el('span', { class: `tag ${item.scope === 'global' ? '' : 'blue'}` }, SCOPE_LABEL[item.scope] || item.scope),
      item.source === 'auto' ? el('span', { class: 'tag amber' }, '自动') : null,
    ].filter(Boolean),
    blank: () => ({ scope: 'global', target: '', key: '', value: '', weight: 2, source: 'manual', enabled: true }),
    form: (draft, h) => [
      el(
        'div',
        { class: 'row' },
        el('div', {}, field('记忆范围', h.select('scope', [
          { value: 'global', label: '全局（所有对话）' },
          { value: 'user', label: '单聊用户（按 openid）' },
          { value: 'group', label: '群聊（按群 + 成员 openid）' },
        ]))),
        el('div', {}, field('重要程度', h.number('weight', { min: 1, max: 3 }), '1~3，越大越优先注入给模型。')),
      ),
      field(
        '作用对象 openid',
        h.input('target', { placeholder: '选择「全局」时留空；否则填用户或群的 openid', class: 'input mono' }),
        '在「消息日志」里可以看到每条消息对应的 openid。',
      ),
      field('记忆主题', h.input('key', { placeholder: '例如：称呼 / 所在地 / 偏好' }), '简短的主题词，会作为注入时的标签。'),
      field('记忆内容', h.textarea('value', { placeholder: '例如：喜欢别人叫他老王', class: 'textarea' }), '具体内容，建议 60 字以内。'),
      h.toggle('enabled', '启用这条记忆'),
    ],
  }),
};
