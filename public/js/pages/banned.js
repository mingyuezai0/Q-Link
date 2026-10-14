import { crudPage } from './_crud.js';
import { el, field } from '../ui.js';

const ACTION_LABEL = { block: '拦截', replace: '替换', warn: '仅记录' };
const SCOPE_LABEL = { all: '双向', input: '仅用户输入', output: '仅模型输出' };

export default {
  render: crudPage({
    endpoint: '/api/banned',
    pageTitle: '违禁词',
    paneTitle: '词条',
    noun: '违禁词',
    iconName: 'shield',
    searchPlaceholder: '搜索违禁词',
    emptyTitle: '还没有违禁词',
    emptyText: '加一条试试，例如把某个竞品名设为「替换」成 ***。',
    primary: (item) => item.word || '未设置词条',
    secondary: (item) =>
      `${ACTION_LABEL[item.action] || item.action} · ${SCOPE_LABEL[item.scope] || '双向'}${item.notice ? ` · 回复「${item.notice}」` : ''}`,
    searchText: (item) => `${item.word} ${item.notice}`,
    badge: (item) => [
      el(
        'span',
        { class: `tag ${item.action === 'block' ? 'red' : item.action === 'replace' ? 'amber' : ''}` },
        ACTION_LABEL[item.action] || item.action,
      ),
      item.hits ? el('span', { class: 'tag mono' }, `${item.hits} 次`) : null,
    ].filter(Boolean),
    blank: () => ({ word: '', matchType: 'contains', action: 'block', replacement: '*', scope: 'all', notice: '', priority: 100, enabled: true }),
    form: (draft, h) => [
      el(
        'div',
        { class: 'row' },
        el('div', {}, field('词 / 正则', h.input('word', { placeholder: '例如：加微信 或 \\d{11}', class: 'input mono' }))),
        el('div', {}, field('匹配方式', h.select('matchType', [
          { value: 'contains', label: '包含即可' },
          { value: 'exact', label: '完全相等' },
          { value: 'regex', label: '正则表达式' },
        ]))),
      ),
      el(
        'div',
        { class: 'row' },
        el('div', {}, field('命中动作', h.select('action', [
          { value: 'block', label: '拦截，不发给用户' },
          { value: 'replace', label: '替换成安全内容' },
          { value: 'warn', label: '仅记录，照常发送' },
        ]))),
        el('div', {}, field('检查范围', h.select('scope', [
          { value: 'all', label: '用户输入 + 模型输出' },
          { value: 'input', label: '仅用户输入' },
          { value: 'output', label: '仅模型输出' },
        ]))),
      ),
      draft.action === 'replace'
        ? field('替换为', h.input('replacement', { placeholder: '例如：***' }), '支持正则替换写法（$1 引用分组）。')
        : el('div'),
      field(
        '命中后的回复话术',
        h.textarea('notice', { class: 'textarea', placeholder: '留空则不回复，直接静默处理' }),
        '拦截用户输入时，会把这句发给对方；拦截模型输出时，会用这句替换模型的原话。',
      ),
      el(
        'div',
        { class: 'row' },
        el('div', {}, field('优先级', h.number('priority', { min: 0, max: 999 }), '数字小的先检查。')),
        el('div', { style: 'padding-top:26px' }, h.toggle('enabled', '启用这条规则')),
      ),
      el(
        'div',
        { class: 'notice warn' },
        el('span', {}, '提示：这里的过滤发生在本地，用于兜住你自己定义的边界；平台侧的内容安全审查仍然独立生效。'),
      ),
    ],
  }),
};
