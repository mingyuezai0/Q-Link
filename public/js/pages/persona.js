import { api } from '../api.js';
import { el, icon, mount, clear, toast, field, clockTime, sliderField } from '../ui.js';
import { app, activeBot, loadBots } from '../app.js';

/** 滑杆值的文字描述，与服务端 rules.js 里的分档保持一致 */
const bandText = (value, bands) => {
  const v = Number(value);
  if (!Number.isFinite(v)) return '';
  for (const b of bands) if (v <= b.max) return b.text;
  return bands[bands.length - 1].text;
};

const DESC = {
  tone: (v) =>
    bandText(v, [
      { max: 20, text: '安静克制' },
      { max: 45, text: '平和自然' },
      { max: 70, text: '亲切随和' },
      { max: 88, text: '活泼俏皮' },
      { max: 100, text: '非常活跃' },
    ]),
  replyLength: (v) =>
    bandText(v, [
      { max: 18, text: '极简，一句话' },
      { max: 42, text: '简短，1~2 句' },
      { max: 70, text: '适中，2~4 句' },
      { max: 88, text: '可以展开讲' },
      { max: 100, text: '详尽，可分点' },
    ]),
  emojiLevel: (v) =>
    bandText(v, [
      { max: 12, text: '完全不用' },
      { max: 38, text: '偶尔一个' },
      { max: 72, text: '自然使用' },
      { max: 100, text: '经常使用' },
    ]),
  humor: (v) =>
    bandText(v, [
      { max: 22, text: '一本正经' },
      { max: 58, text: '偶尔调侃' },
      { max: 100, text: '很爱开玩笑' },
    ]),
  initiative: (v) =>
    bandText(v, [
      { max: 22, text: '问什么答什么' },
      { max: 58, text: '会追问一句' },
      { max: 100, text: '主动找话题' },
    ]),
  formality: (v) =>
    bandText(v, [
      { max: 22, text: '很随意口语' },
      { max: 62, text: '口语但得体' },
      { max: 100, text: '正式得体' },
    ]),
};

export default {
  async render(host, ctx) {
    const persona = await api.get('/api/persona');
    const draft = structuredClone(persona);
    app.persona = persona;

    let bot = activeBot();
    const profile = { name: bot?.name || persona.name || '小Q', avatar: bot?.avatar || persona.avatar || '' };

    /* ------------------------------------------------------- 资料表单 */

    const avatarPreview = el('div', { class: 'avatar-preview' });
    const drawAvatar = () => {
      clear(avatarPreview);
      if (profile.avatar) avatarPreview.append(el('img', { src: profile.avatar, alt: profile.name }));
      else avatarPreview.textContent = String(profile.name || 'Q').slice(0, 1).toUpperCase();
    };
    drawAvatar();

    const avatarInput = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/gif,image/webp',
      class: 'hidden',
    });

    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files?.[0];
      avatarInput.value = '';
      if (!file) return;
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('读取文件失败'));
          reader.readAsDataURL(file);
        });
        const uploaded = await api.post('/api/upload', { mime: file.type, data: dataUrl });
        profile.avatar = uploaded.url;
        drawAvatar();
        await saveProfile({ silent: true });
        toast('头像已更新', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    const nameInput = el('input', {
      class: 'input',
      value: profile.name,
      placeholder: '机器人叫什么',
      oninput: (e) => {
        profile.name = e.target.value;
        drawAvatar();
      },
    });

    async function saveProfile({ silent = false } = {}) {
      const result = await api.put('/api/bot/profile', { name: profile.name, avatar: profile.avatar });
      draft.name = result.bot?.name || profile.name;
      draft.avatar = result.bot?.avatar || profile.avatar;
      await loadBots();
      if (!silent) toast('机器人资料已保存', 'ok');
      return result;
    }

    /* --------------------------------------------------- 平台侧资料 */

    const platformBox = el('div', { class: 'platform-read' });
    // 内容为空时把整个 body 一起收起来，避免留下一块空白
    const platformBody = el('div', { class: 'card-body' }, platformBox);
    const syncPlatformBody = () => platformBody.classList.toggle('is-empty', platformBox.childElementCount === 0);

    const renderPlatform = (state = {}) => {
      clear(platformBox);
      if (state.error) {
        platformBox.append(el('div', { class: 'notice danger' }, icon('alert', 14), el('span', {}, state.error)));
        syncPlatformBody();
        return;
      }
      if (!state.loaded) {
        syncPlatformBody();
        return;
      }
      const row = el('div', { class: 'platform-row' });
      const face = el('div', { class: 'avatar', style: 'width:44px;height:44px' });
      if (state.avatar) face.append(el('img', { src: state.avatar, alt: '' }));
      else face.textContent = String(state.username || 'Q').slice(0, 1);
      row.append(
        face,
        el(
          'div',
          { class: 'flex-1' },
          el('b', {}, state.username || '（平台未返回昵称）'),
          el('span', { class: 'small muted', style: 'display:block' }, `AppID ${state.appId || '—'}`),
        ),
        el('span', { class: 'tag green' }, '平台在线'),
      );
      platformBox.append(row);
      syncPlatformBody();
    };
    renderPlatform();

    /* -------------------------------------------------------- 说话方式 */

    const bind = (key, props = {}) => {
      const node = el('input', { class: 'input', value: draft[key] ?? '', ...props });
      node.addEventListener('input', () => (draft[key] = node.value));
      return node;
    };

    /** 人设滑杆：改了就写进 draft，保存时一次性提交 */
    const slider = (key, label, left, right) =>
      sliderField({
        label,
        value: draft[key],
        left,
        right,
        step: 5,
        describe: DESC[key],
        onChange: (v) => {
          draft[key] = v;
        },
      });

    const rulesArea = el('textarea', { class: 'textarea', placeholder: '每行一条' });
    rulesArea.value = (draft.rules || []).join('\n');
    rulesArea.addEventListener('input', () => {
      draft.rules = rulesArea.value.split('\n').map((s) => s.trim()).filter(Boolean);
    });

    const systemArea = el('textarea', { class: 'textarea tall' });
    systemArea.value = draft.system || '';
    systemArea.addEventListener('input', () => (draft.system = systemArea.value));

    const tabooArea = el('textarea', { class: 'textarea' });
    tabooArea.value = draft.taboo || '';
    tabooArea.addEventListener('input', () => (draft.taboo = tabooArea.value));

    /* ------------------------------------------------------- 试聊窗口 */

    const chatScroll = el('div', { class: 'chat-scroll' });
    const hitStrip = el('div', { class: 'hit-strip' });
    const inputNode = el('input', { placeholder: '说点什么，试试它现在的性格…' });
    const sendBtn = el('button', { class: 'chat-send', type: 'button' }, '发送');
    const messages = [];

    function bubble(message) {
      const isMe = message.role === 'user';
      const face = el('div', { class: 'face' });
      if (isMe) face.textContent = '我';
      else if (profile.avatar) face.append(el('img', { src: profile.avatar, alt: '' }));
      else face.textContent = String(profile.name || 'Q').slice(0, 1).toUpperCase();

      const body = el('div', { class: 'bubble' });
      if (message.typing) {
        body.classList.add('typing');
        body.append(el('span'), el('span'), el('span'));
      } else if (message.sticker && !message.text) {
        body.append(el('img', { src: message.sticker.url || `/uploads/${message.sticker.file}`, alt: '' }));
      } else {
        body.append(document.createTextNode(message.text || ''));
        if (message.sticker) {
          body.append(
            el('img', { src: message.sticker.url || `/uploads/${message.sticker.file}`, alt: '', style: 'margin-top:6px' }),
          );
        }
      }
      if (message.notes?.length) body.append(el('div', { class: 'meta' }, message.notes.join(' · ')));
      return el('div', { class: `bubble-row${isMe ? ' me' : ''}` }, face, body);
    }

    function renderChat() {
      clear(chatScroll);
      chatScroll.append(el('div', { class: 'chat-day' }, `今天 ${clockTime()}`));
      if (!messages.length) chatScroll.append(bubble({ role: 'bot', text: draft.greeting || `你好呀，我是${profile.name}` }));
      for (const m of messages) chatScroll.append(bubble(m));
      chatScroll.scrollTop = chatScroll.scrollHeight;
    }

    function renderHits(notes) {
      clear(hitStrip);
      if (!notes?.length) {
        hitStrip.append(el('span', {}, '规则命中会显示在这里'));
        return;
      }
      for (const note of notes) hitStrip.append(el('span', { class: 'tag blue' }, note));
    }
    renderHits([]);

    const phoneFace = el('div', { class: 'face' });
    const drawPhoneFace = () => {
      clear(phoneFace);
      if (profile.avatar) phoneFace.append(el('img', { src: profile.avatar, alt: '' }));
      else phoneFace.textContent = String(profile.name || 'Q').slice(0, 1).toUpperCase();
    };
    drawPhoneFace();

    const phoneName = el('b', {}, profile.name || '未命名');

    async function send() {
      const text = inputNode.value.trim();
      if (!text) return;
      inputNode.value = '';
      messages.push({ role: 'user', text });
      const typing = { role: 'bot', typing: true };
      messages.push(typing);
      renderChat();
      sendBtn.disabled = true;
      try {
        await api.put('/api/persona', draft);
        const result = await api.post('/api/preview', { text });
        const index = messages.indexOf(typing);
        if (index !== -1) messages.splice(index, 1);
        messages.push({
          role: 'bot',
          text: result.text || '（无回复）',
          sticker: result.sticker,
          notes: result.error ? [result.error] : result.notes,
        });
        renderChat();
        renderHits(result.notes || []);
      } catch (err) {
        const index = messages.indexOf(typing);
        if (index !== -1) messages.splice(index, 1);
        messages.push({ role: 'bot', text: `（出错：${err.message}）` });
        renderChat();
        toast(err.message, 'error');
      } finally {
        sendBtn.disabled = false;
        inputNode.focus();
      }
    }
    sendBtn.addEventListener('click', send);
    inputNode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });

    async function savePersona(e) {
      e.target.disabled = true;
      try {
        await saveProfile({ silent: true });
        const saved = await api.put('/api/persona', draft);
        app.persona = saved;
        renderChat();
        toast('人设已保存并即时生效', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        e.target.disabled = false;
      }
    }

    /* ---------------------------------------------------------- 页面 */

    mount(
      host,
      el('div', { class: 'page-head' }, el('h1', {}, 'AI 人设')),
      el(
        'div',
        { class: 'chat-stage' },
        el(
          'div',
          {},
          /* ---- 机器人资料（同时是侧边栏显示的身份）---- */
          el(
            'div',
            { class: 'card' },
            el(
              'div',
              { class: 'card-head' },
              el('h2', {}, '机器人身份'),
              el('span', { class: 'hint' }, '显示在控制台左下角，也用作它自我介绍的名字'),
            ),
            el(
              'div',
              { class: 'card-body' },
              el(
                'div',
                { class: 'profile-row' },
                avatarPreview,
                el(
                  'div',
                  { class: 'flex-1' },
                  field('昵称', nameInput),
                  el(
                    'div',
                    { class: 'row-inline' },
                    el(
                      'button',
                      { class: 'btn btn-sm', type: 'button', onclick: () => avatarInput.click() },
                      icon('upload', 13),
                      '从本地选择头像',
                    ),
                    profile.avatar
                      ? el(
                          'button',
                          {
                            class: 'btn btn-sm btn-ghost btn-danger',
                            type: 'button',
                            onclick: async () => {
                              profile.avatar = '';
                              drawAvatar();
                              await saveProfile({ silent: true });
                              toast('已恢复为文字头像', 'ok');
                            },
                          },
                          '清除头像',
                        )
                      : null,
                    el('span', { class: 'small muted' }, '支持 PNG / JPG / GIF / WebP，建议正方形'),
                  ),
                ),
              ),
              avatarInput,
            ),
            el(
              'div',
              { class: 'card-head', style: 'border-top:1px solid var(--line-2)' },
              el('h2', {}, '平台侧资料'),
              el('span', { class: 'hint' }, 'QQ 开放平台的内容，只读'),
              el(
                'button',
                {
                  class: 'btn btn-sm',
                  type: 'button',
                  onclick: async (e) => {
                    e.target.disabled = true;
                    try {
                      const r = await api.post('/api/config/test');
                      renderPlatform({
                        loaded: true,
                        username: r.bot?.username,
                        avatar: r.bot?.avatar,
                        appId: activeBot()?.appIdHint,
                      });
                      toast('已读取平台资料', 'ok');
                    } catch (err) {
                      renderPlatform({ error: `读取失败：${err.message}` });
                    } finally {
                      e.target.disabled = false;
                    }
                  },
                },
                icon('refresh', 13),
                '从平台读取',
              ),
            ),
            platformBody,
          ),

          /* ---- 说话方式 ---- */
          el(
            'div',
            { class: 'card' },
            el(
              'div',
              { class: 'card-head' },
              el('h2', {}, '说话方式'),
              el('span', { class: 'hint' }, '拖动滑杆即可，右端数值就是给模型的具体指令'),
            ),
            el(
              'div',
              { class: 'card-body' },
              slider('tone', '语气', '安静克制', '活跃活泼'),
              slider('replyLength', '回复长度', '简短', '详尽'),
              slider('emojiLevel', '表情使用程度', '不用表情', '经常使用'),
              el(
                'div',
                { class: 'detail-sliders' },
                el('div', { class: 'detail-sliders-title' }, '详细调节'),
                el(
                  'div',
                  { class: 'slider-grid' },
                  slider('humor', '幽默感', '一本正经', '很爱开玩笑'),
                  slider('initiative', '主动性', '问什么答什么', '主动找话题'),
                  slider('formality', '用词正式度', '很随意口语', '正式得体'),
                ),
              ),
            ),
          ),

          /* ---- 文本补充 ---- */
          el(
            'div',
            { class: 'card' },
            el(
              'div',
              { class: 'card-head' },
              el('h2', {}, '风格补充'),
              el('span', { class: 'hint' }, '滑杆说不清的部分，用文字补'),
            ),
            el(
              'div',
              { class: 'card-body' },
              field('风格描述', bind('style', { placeholder: '例如：口语化短句，偶尔用语气词' })),
              field('开场问候', bind('greeting', { placeholder: '用户第一次搭话时的默认回复' })),
            ),
          ),

          /* ---- 系统提示词 ---- */
          el(
            'div',
            { class: 'card' },
            el('div', { class: 'card-head' }, el('h2', {}, '系统提示词'), el('span', { class: 'hint' }, '最核心的一段')),
            el(
              'div',
              { class: 'card-body' },
              field('身份描述', bind('identity', { placeholder: '例如：住在 QQ 里的 AI 伙伴' })),
              field('人设正文', systemArea, '会原样作为 system 消息发给模型，建议用短句、一条一行。'),
            ),
          ),

          /* ---- 边界与习惯 ---- */
          el(
            'div',
            { class: 'card' },
            el('div', { class: 'card-head' }, el('h2', {}, '边界与习惯')),
            el(
              'div',
              { class: 'card-body' },
              field('行为准则', rulesArea, '每行一条，会编号后写进系统提示。'),
              field('禁忌话题', tabooArea, '遇到这些话题时的处理原则。'),
              field('署名习惯', bind('signature', { placeholder: '留空则不署名' })),
            ),
            el(
              'div',
              { class: 'card-foot' },
              el('button', { class: 'btn btn-primary', type: 'button', onclick: savePersona }, icon('save', 14), '保存人设'),
              el('button', { class: 'btn', type: 'button', onclick: () => ctx.refresh() }, '放弃修改'),
              el('span', { class: 'spacer' }),
              el(
                'button',
                {
                  class: 'btn btn-ghost btn-sm',
                  type: 'button',
                  onclick: () => {
                    messages.length = 0;
                    renderHits([]);
                    renderChat();
                    toast('试聊窗口已清空', 'info');
                  },
                },
                '清空试聊',
              ),
            ),
          ),
        ),

        /* ---- 试聊窗口 ---- */
        el(
          'div',
          { class: 'phone' },
          el(
            'div',
            { class: 'phone-bar' },
            el('span', { class: 'back' }, icon('chevron', 15)),
            phoneFace,
            el('div', { class: 'who' }, phoneName, el('i', {}, '在线')),
          ),
          chatScroll,
          hitStrip,
          el('div', { class: 'chat-input' }, inputNode, sendBtn),
        ),
      ),
    );

    // 名字改了同步到试聊窗口标题
    nameInput.addEventListener('input', () => {
      phoneName.textContent = profile.name || '未命名';
    });

    renderChat();
    return () => {};
  },
};
