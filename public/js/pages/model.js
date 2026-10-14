import { api } from '../api.js';
import { el, icon, mount, toast, field, confirmDialog } from '../ui.js';

export default {
  async render(host, ctx) {
    const config = await api.get('/api/config');
    const draft = structuredClone(config);

    const bindNumber = (obj, key, props = {}) => {
      const node = el('input', { class: 'input mono', type: 'number', value: obj[key] ?? 0, ...props });
      node.addEventListener('input', () => (obj[key] = node.value === '' ? 0 : Number(node.value)));
      return node;
    };
    const bindText = (obj, key, props = {}) => {
      const node = el('input', { class: 'input', value: obj[key] ?? '', ...props });
      node.addEventListener('input', () => (obj[key] = node.value));
      return node;
    };
    const toggle = (obj, key, label, desc) =>
      el(
        'label',
        { class: 'switch', style: 'align-items:flex-start;margin-bottom:12px' },
        el('input', { type: 'checkbox', checked: obj[key] !== false, onchange: (e) => (obj[key] = e.target.checked) }),
        el('span', { class: 'track', style: 'margin-top:2px' }),
        el(
          'span',
          { class: 'switch-label' },
          el('span', { style: 'font-weight:600;display:block' }, label),
          desc ? el('span', { class: 'small muted' }, desc) : null,
        ),
      );

    const apiKeyInput = bindText(draft.ai, 'apiKey', { type: 'password', class: 'input mono', placeholder: 'sk-…' });

    /* 快捷预设：常见 OpenAI 兼容服务 */
    const PRESETS = [
      { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      { label: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
      { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
      { label: '月之暗面', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
      { label: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
    ];
    const presetRow = el('div', { class: 'row-inline' });
    for (const preset of PRESETS) {
      presetRow.append(
        el(
          'button',
          {
            class: 'btn btn-sm',
            type: 'button',
            onclick: () => {
              draft.ai.baseUrl = preset.baseUrl;
              draft.ai.model = preset.model;
              baseUrlInput.value = preset.baseUrl;
              modelInput.value = preset.model;
              toast(`已切换到 ${preset.label}，别忘了保存`, 'info');
            },
          },
          preset.label,
        ),
      );
    }

    const baseUrlInput = bindText(draft.ai, 'baseUrl', { class: 'input mono', placeholder: 'https://api.deepseek.com/v1' });
    const modelInput = bindText(draft.ai, 'model', { class: 'input mono', placeholder: 'deepseek-chat' });

    async function save(silent = false) {
      await api.put('/api/config', draft);
      if (!silent) toast('设置已保存', 'ok');
      await ctx.refresh();
    }

    mount(
      host,
      el('div', { class: 'page-head' }, el('h1', {}, 'AI 模型')),

      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', {}, '模型接入'), el('span', { class: 'hint' }, '配置只保存在本机')),
        el(
          'div',
          { class: 'card-body' },
          el(
            'div',
            { class: 'field' },
            el('label', {}, '快捷预设'),
            presetRow,
            el('div', { class: 'desc' }, '点一下自动填入接口地址和模型名。'),
          ),
          field('接口地址（baseUrl）', baseUrlInput, '填写到 /v1 为止，系统会自动补 /chat/completions。'),
          field(
            'API Key',
            el('div', { class: 'row-inline', style: 'gap:8px' }, el('span', { class: 'flex-1' }, apiKeyInput)),
            '只写入 data/config.json，不会带进任何提示词或日志。',
          ),
          el(
            'div',
            { class: 'row' },
            el('div', {}, field('模型名称', modelInput)),
            el('div', {}, field('携带历史轮数', bindNumber(draft.ai, 'historyRounds', { min: 0, max: 30 }), '每轮 = 一问一答，越大越连贯也越贵。')),
          ),
          el(
            'div',
            { class: 'row' },
            el('div', {}, field('温度', bindNumber(draft.ai, 'temperature', { min: 0, max: 2, step: 0.1 }), '越高越活泼，0.7~0.9 适合聊天。')),
            el('div', {}, field('最大回复 token', bindNumber(draft.ai, 'maxTokens', { min: 64, max: 8192 }))),
          ),
        ),
        el(
          'div',
          { class: 'card-foot' },
          el('button', { class: 'btn btn-primary', type: 'button', onclick: () => save() }, icon('save', 14), '保存设置'),
          el(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  await api.put('/api/config', draft);
                  const r = await api.post('/api/config/test-ai', {});
                  toast(`模型正常，${r.ms}ms 内返回「${r.reply}」`, 'ok', 4000);
                } catch (err) {
                  toast(`连接失败：${err.message}`, 'error', 6000);
                } finally {
                  e.target.disabled = false;
                }
              },
            },
            icon('check', 14),
            '测试连接',
          ),
        ),
      ),

      el(
        'div',
        { class: 'grid grid-2' },
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'card-head' }, el('h2', {}, '回复行为')),
          el(
            'div',
            { class: 'card-body' },
            toggle(draft.reply, 'privateEnabled', '响应单聊消息', '关闭后私聊找它也不会回复。'),
            toggle(draft.reply, 'groupEnabled', '响应群聊消息', '群主允许加入后，机器人才会收到群消息。'),
            toggle(
              draft.reply,
              'groupRequireMention',
              '群里只回应 @ 它的消息',
              '群主开启「接收所有消息」后，关掉这一项它才会接群里的闲聊。',
            ),
            toggle(draft.reply, 'quoteReply', '引用用户的原消息再回复', '第一段回复会挂在用户那条消息下面，上下文更清楚。'),
            toggle(draft.reply, 'errorNotice', '模型出错时回复一句提示', '否则出错就静默不回复。'),
            el(
              'div',
              { class: 'row' },
              el('div', {}, field('单条消息最大长度', bindNumber(draft.reply, 'maxLength', { min: 100, max: 2000 }), '超过会按句号、换行自动分段发送。')),
              el('div', { style: 'padding-top:26px' }, toggle(draft.reply, 'logMessages', '记录消息到日志')),
            ),
          ),
        ),
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'card-head' },
            el('h2', {}, '名单态度'),
            el('span', { class: 'hint' }, '名单里的每个人还能单独覆盖这里的默认值'),
          ),
          el(
            'div',
            { class: 'card-body' },
            field(
              '白名单默认态度',
              (() => {
                const seg = el('div', { class: 'segmented' });
                for (const opt of [
                  { value: 'warm', label: '更熟络热情' },
                  { value: 'normal', label: '照常对待' },
                ]) {
                  const btn = el(
                    'button',
                    {
                      type: 'button',
                      'aria-pressed': String(draft.lists.whitelistMode === opt.value),
                      onclick: () => {
                        draft.lists.whitelistMode = opt.value;
                        for (const other of seg.children) other.setAttribute('aria-pressed', 'false');
                        btn.setAttribute('aria-pressed', 'true');
                      },
                    },
                    opt.label,
                  );
                  seg.append(btn);
                }
                return seg;
              })(),
              '名单里的人会得到更随意的语气，机器人可以主动关心近况、开玩笑。',
            ),
            field(
              '黑名单默认态度',
              (() => {
                const seg = el('div', { class: 'segmented' });
                for (const opt of [
                  { value: 'ignore', label: '完全不回复' },
                  { value: 'cold', label: '冷淡回复' },
                ]) {
                  const btn = el(
                    'button',
                    {
                      type: 'button',
                      'aria-pressed': String(draft.lists.blacklistMode === opt.value),
                      onclick: () => {
                        draft.lists.blacklistMode = opt.value;
                        for (const other of seg.children) other.setAttribute('aria-pressed', 'false');
                        btn.setAttribute('aria-pressed', 'true');
                      },
                    },
                    opt.label,
                  );
                  seg.append(btn);
                }
                return seg;
              })(),
            ),
            field(
              '冷淡模式的冷却时间（秒）',
              bindNumber(draft.lists, 'blacklistCooldown', { min: 0, max: 86400 }),
              '冷却期内对方再发消息也不会得到回应。',
            ),
            el(
              'div',
              { class: 'notice' },
              icon('info', 14),
              el('span', {}, '名单按 openid 识别而不是昵称，所以对方改名也不会认错。到「名单」页添加与管理。'),
            ),
          ),
        ),
      ),

      el(
        'div',
        { class: 'grid grid-2' },
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'card-head' }, el('h2', {}, '功能开关')),
          el(
            'div',
            { class: 'card-body' },
            toggle(draft.features, 'keywords', '关键词记忆', '提到关键词时把它记着的详情想起来。'),
            toggle(draft.features, 'banned', '违禁词', '在本地过滤用户输入与模型输出。'),
            toggle(draft.features, 'lists', '白名单 / 黑名单', '按名单区分对待不同的人。'),
            toggle(draft.features, 'memes', '梗知识', '把命中的梗解释注入模型上下文。'),
            toggle(draft.features, 'memory', '记忆库', '把长期记忆注入模型上下文。'),
            toggle(draft.features, 'stickers', '表情包', '允许模型在回复里发图。'),
            toggle(draft.features, 'autoMemory', '自动记忆', '定期从对话里提取值得记住的信息，包含关键词记忆。'),
            el(
              'div',
              { class: 'row', style: 'align-items:center' },
              el('div', {}, field('每多少条消息提取一次', bindNumber(draft.features, 'autoMemoryEvery', { min: 2, max: 50 }), '太频繁会明显增加模型调用量。')),
            ),
          ),
        ),
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'card-head' }, el('h2', {}, '数据')),
          el(
            'div',
            { class: 'card-body' },
            el('p', { class: 'muted mt-0' }, '每台机器人都有独立的数据目录，可以直接备份或迁移到另一台机器。'),
          ),
          el(
            'div',
            { class: 'card-foot' },
            el('a', { class: 'btn', href: '/api/export', download: '' }, icon('save', 14), '导出当前机器人配置'),
            el(
              'button',
              {
                class: 'btn btn-danger',
                type: 'button',
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: '清空所有对话记录？',
                    message: '消息日志与会话上下文会被清空，人设、词库、名单、表情包不受影响。',
                    confirmText: '清空记录',
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api.del('/api/logs');
                    toast('已清空对话记录', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('trash', 14),
              '清空对话记录',
            ),
          ),
        ),
      ),
    );

    return () => {};
  },
};
