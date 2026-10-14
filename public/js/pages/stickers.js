import { api } from '../api.js';
import { el, icon, mount, clear, toast, confirmDialog, field } from '../ui.js';

export default {
  async render(host, ctx) {
    let items = await api.get('/api/stickers');
    let selectedId = items[0]?.id || null;
    let draft = null;

    const grid = el('div', { class: 'sticker-grid' });
    const counter = el('span', { class: 'count mono-num' });
    const editorHost = el('div');

    /* ----------------------------------------------------------- 上传 */

    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, class: 'hidden' });

    async function uploadFiles(files) {
      const list = Array.from(files || []);
      if (!list.length) return;
      let done = 0;
      for (const file of list) {
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsDataURL(file);
          });
          const item = await api.post('/api/stickers/upload', {
            name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || '未命名',
            mime: file.type,
            data: dataUrl,
          });
          items.unshift(item);
          selectedId = item.id;
          done += 1;
        } catch (err) {
          toast(`${file.name}：${err.message}`, 'error', 5000);
        }
      }
      if (done) {
        toast(`已上传 ${done} 张表情包`, 'ok');
        renderGrid();
        renderEditor();
      }
    }

    fileInput.addEventListener('change', () => {
      uploadFiles(fileInput.files);
      fileInput.value = '';
    });

    const dropzone = el(
      'div',
      {
        class: 'dropzone',
        onclick: () => fileInput.click(),
        ondragover: (e) => {
          e.preventDefault();
          dropzone.classList.add('over');
        },
        ondragleave: () => dropzone.classList.remove('over'),
        ondrop: (e) => {
          e.preventDefault();
          dropzone.classList.remove('over');
          uploadFiles(e.dataTransfer?.files);
        },
      },
      el('div', { style: 'display:flex;justify-content:center;margin-bottom:6px' }, icon('upload', 24)),
      el('div', { style: 'font-weight:600' }, '把图片拖到这里，或点击选择'),
      el('div', { class: 'small', style: 'margin-top:2px' }, '支持 PNG / JPG / GIF / WebP，单张不超过 4.5MB'),
    );

    /* ----------------------------------------------------------- 列表 */

    function renderGrid() {
      clear(grid);
      counter.textContent = items.length ? `${items.length} 张` : '';
      if (!items.length) return; // 上方就是拖拽区，不再重复空状态
      for (const item of items) {
        grid.append(
          el(
            'div',
            {
              class: 'sticker-cell',
              role: 'button',
              tabindex: '0',
              'aria-selected': String(item.id === selectedId),
              onclick: () => {
                selectedId = item.id;
                renderGrid();
                renderEditor();
              },
              onkeydown: (e) => {
                if (e.key === 'Enter') {
                  selectedId = item.id;
                  renderGrid();
                  renderEditor();
                }
              },
            },
            el(
              'div',
              { class: 'thumb' },
              item.file
                ? el('img', { src: `/uploads/${item.file}`, alt: item.name, loading: 'lazy' })
                : el('span', { class: 'muted small' }, '无图'),
            ),
            el('div', { class: 'cap' }, item.name, item.tags?.length ? el('i', {}, ` · ${item.tags.join('/')}`) : null),
          ),
        );
      }
    }

    /* ----------------------------------------------------------- 编辑 */

    function renderEditor() {
      clear(editorHost);
      const item = items.find((i) => i.id === selectedId);
      if (!item) {
        editorHost.append(
          el(
            'div',
            { class: 'empty' },
            el('h3', {}, items.length ? '从左侧选一张表情包' : '先上传一张表情包'),
            el('p', {}, '名称是模型调用它的唯一依据，起个好记的名字。'),
          ),
        );
        return;
      }
      draft = structuredClone(item);

      const nameInput = el('input', { class: 'input', value: draft.name || '', oninput: (e) => (draft.name = e.target.value) });
      const tagsInput = el('input', {
        class: 'input',
        placeholder: '例如：打招呼,开心,无语',
        value: (draft.tags || []).join('、'),
        oninput: (e) =>
          (draft.tags = e.target.value
            .split(/[,，、\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)),
      });

      editorHost.append(
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'card-head' },
            el('h2', {}, item.name || '未命名'),
            item.enabled === false ? el('span', { class: 'tag' }, '已停用') : el('span', { class: 'tag green' }, '可用'),
            item.usage ? el('span', { class: 'tag blue mono' }, `用过 ${item.usage} 次`) : null,
          ),
          el(
            'div',
            { class: 'card-body' },
            el(
              'div',
              { class: 'row' },
              el(
                'div',
                { class: 'row-fixed', style: 'width:132px' },
                el('div', {
                  class: 'thumb',
                  style:
                    'height:132px;border:1px solid var(--line);border-radius:8px;display:grid;place-items:center;background:var(--bg-2);overflow:hidden',
                  html: item.file ? `<img src="/uploads/${item.file}" alt="" style="max-width:100%;max-height:132px;object-fit:contain">` : '',
                }),
              ),
              el(
                'div',
                {},
                field('名称', nameInput, '模型通过这个名字调用它，例如 [sticker:开心] 就会发出这张图。'),
                field('标签', tagsInput, '用来描述使用场景，会和名称一起写进系统提示。'),
                el(
                  'label',
                  { class: 'switch' },
                  el('input', {
                    type: 'checkbox',
                    checked: draft.enabled !== false,
                    onchange: (e) => (draft.enabled = e.target.checked),
                  }),
                  el('span', { class: 'track' }),
                  el('span', { class: 'switch-label' }, '允许模型使用这张表情包'),
                ),
              ),
            ),
            el(
              'div',
              { class: 'notice mt-12' },
              icon('info', 14),
              el(
                'span',
                {},
                '模型会在回复末尾写 ',
                el('code', { class: 'mono' }, `[sticker:${item.name || '名称'}]`),
                '，系统就发送对应图片并把这个标记去掉。可以在「AI 人设」的试聊窗口里验证效果。',
              ),
            ),
          ),
          el(
            'div',
            { class: 'card-foot' },
            el(
              'button',
              {
                class: 'btn btn-primary',
                type: 'button',
                onclick: async (e) => {
                  e.target.disabled = true;
                  try {
                    const saved = await api.put(`/api/stickers/${item.id}`, draft);
                    const index = items.findIndex((i) => i.id === item.id);
                    items[index] = { ...items[index], ...saved };
                    renderGrid();
                    renderEditor();
                    toast('表情包已保存', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  } finally {
                    e.target.disabled = false;
                  }
                },
              },
              icon('save', 14),
              '保存',
            ),
            el('span', { class: 'spacer' }),
            el(
              'button',
              {
                class: 'btn btn-danger',
                type: 'button',
                onclick: async () => {
                  const ok = await confirmDialog({
                    title: '删除这张表情包？',
                    message: `「${item.name}」的图片记录会被删除，已经发出去的图片不受影响。`,
                    confirmText: '删除',
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api.del(`/api/stickers/${item.id}`);
                    items = items.filter((i) => i.id !== item.id);
                    selectedId = items[0]?.id || null;
                    renderGrid();
                    renderEditor();
                    toast('已删除', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('trash', 14),
              '删除',
            ),
          ),
        ),
      );
    }

    /* ----------------------------------------------------------- 页面 */

    mount(
      host,
      el('div', { class: 'page-head' }, el('h1', {}, '表情包')),
      fileInput,
      el(
        'div',
        { class: 'grid', style: 'grid-template-columns:minmax(0,1fr) 380px' },
        el(
          'div',
          {},
          el(
            'div',
            { class: 'card' },
            el('div', { class: 'card-head' }, el('h2', {}, '素材库'), counter),
            el('div', { class: 'card-body' }, dropzone, el('div', { class: 'mt-16' }, grid)),
          ),
        ),
        el('div', {}, editorHost),
      ),
    );

    renderGrid();
    renderEditor();
    return () => {};
  },
};
