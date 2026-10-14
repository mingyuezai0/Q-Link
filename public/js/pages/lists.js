import { api } from '../api.js';
import { el, icon, mount, clear, toast, confirmDialog, field, timeAgo, openModal, sliderField, sliderBand } from '../ui.js';

const TABS = [
  { tag: 'whitelist', label: '白名单', tone: 'green' },
  { tag: 'blacklist', label: '黑名单', tone: 'red' },
];

/** 态度滑杆：左端冷漠、右端热情，一个滑杆同时表达两份名单的差别 */
export const ATTITUDE_BANDS = [
  { max: 15, value: 'ignore', label: '完全不回复', tone: 'red' },
  { max: 39, value: 'cold', label: '冷淡回复', tone: 'amber' },
  { max: 60, value: 'normal', label: '照常对待', tone: '' },
  { max: 85, value: 'warm', label: '熟络热情', tone: 'green' },
  { max: 100, value: 'devoted', label: '非常亲近', tone: 'green' },
];

const attitudeOf = (person) => {
  if (typeof person.attitude === 'number') return person.attitude;
  return person.listTag === 'blacklist' ? 5 : 80;
};

const bandOf = (attitude) => sliderBand(attitude, ATTITUDE_BANDS);

const describeAttitude = (v) => bandOf(v).label;

/** 最近联系人最少要有几条消息才显示 */
const MIN_MESSAGES = 3;

/**
 * 生成一个稳定的占位头像。
 * 官方接口拿不到用户头像（事件 User 对象里没有 avatar 字段），所以按 openid 算出固定颜色，
 * 这样同一个人每次显示的颜色都一样，也便于肉眼区分。
 */
function avatarFor(seed, name) {
  const key = String(seed || name || '?');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 997;
  const hue = Math.round((hash * 137.5) % 360);
  const node = el('div', { class: 'avatar', style: `width:32px;height:32px;background:linear-gradient(135deg,hsl(${hue} 72% 56%),hsl(${(hue + 28) % 360} 68% 44%))` });
  node.textContent = String(name || key).trim().slice(0, 1).toUpperCase() || '?';
  return node;
}

export default {
  async render(host, ctx) {
    let people = await api.get('/api/people');
    let identities = await api.get('/api/identities');
    let tab = 'whitelist';
    // 首次进入时默认选中当前名单的第一个，右侧不至于空着
    let selectedId = people.filter((p) => p.listTag === tab)[0]?.id || null;

    const listHost = el('div', { class: 'list-scroll' });
    const detailHost = el('div', { class: 'detail-pane' });
    const recentHost = el('div', { class: 'identity-grid' });
    const countLabel = el('span', { class: 'count' });
    const tabBar = el('div', { class: 'tabs' });

    const inTab = () => people.filter((p) => p.listTag === tab);
    const current = () => people.find((p) => p.id === selectedId) || null;

    /* --------------------------------------------------------- 名单列表 */

    function renderTabs() {
      clear(tabBar);
      for (const t of TABS) {
        const n = people.filter((p) => p.listTag === t.tag).length;
        tabBar.append(
          el(
            'button',
            {
              class: `tab${tab === t.tag ? ' active' : ''}`,
              type: 'button',
              onclick: () => {
                tab = t.tag;
                selectedId = null;
                renderTabs();
                renderList();
                renderDetail();
              },
            },
            t.label,
            el('span', { class: 'tab-count' }, String(n)),
          ),
        );
      }
    }

    function renderList() {
      const items = inTab();
      countLabel.textContent = items.length ? `${items.length} 人` : '';
      clear(listHost);

      if (!items.length) {
        listHost.append(
          el(
            'div',
            { class: 'empty', style: 'padding:34px 16px' },
            el('div', { class: 'ico' }, icon('shield', 30)),
            el('h3', {}, tab === 'whitelist' ? '白名单还是空的' : '黑名单还是空的'),
            el('p', {}, '从下面「最近联系过的人」里挑一个，或者手动新建。'),
          ),
        );
        return;
      }

      for (const person of items) {
        const ids = person.openids || [];
        listHost.append(
          el(
            'div',
            {
              class: 'list-item',
              role: 'option',
              tabindex: '0',
              'aria-selected': String(person.id === selectedId),
              onclick: () => {
                selectedId = person.id;
                renderList();
                renderDetail();
              },
            },
            el(
              'div',
              { class: 'li-main' },
              el('div', { class: 'li-title' }, person.alias || '未命名'),
              el(
                'div',
                { class: 'li-sub' },
                `${ids.length} 个身份标识`,
                person.note ? ` · ${person.note}` : '',
              ),
            ),
            el(
              'div',
              { class: 'li-side' },
              (() => {
                const b = bandOf(attitudeOf(person));
                return el('span', { class: `tag ${b.tone}` }, b.label);
              })(),
            ),
          ),
        );
      }
    }

    /* --------------------------------------------------------- 详情编辑 */

    function renderDetail() {
      clear(detailHost);
      const person = current();
      if (!person) {
        detailHost.append(
          el(
            'div',
            { class: 'empty' },
            el('div', { class: 'ico' }, icon('shield', 30)),
            el('h3', {}, inTab().length ? '从左边选一个人' : '先加一个人进来'),
            el('p', {}, '加了之后，可以给他起个备注名，并决定机器人对他什么态度。'),
          ),
        );
        return;
      }

      const draft = structuredClone(person);

      const aliasInput = el('input', {
        class: 'input',
        value: draft.alias || '',
        placeholder: '你给他起的备注名，例如：老王',
        oninput: (e) => (draft.alias = e.target.value),
      });
      const noteInput = el('input', {
        class: 'input',
        value: draft.note || '',
        placeholder: '备注，例如：同事 / 群里的活跃用户',
        oninput: (e) => (draft.note = e.target.value),
      });
      const qqInput = el('input', {
        class: 'input mono-num',
        value: draft.qq || '',
        placeholder: '选填',
        inputmode: 'numeric',
        oninput: (e) => {
          draft.qq = e.target.value.replace(/\D/g, '').slice(0, 12);
          e.target.value = draft.qq;
        },
      });

      const modeRow = el('div', { class: 'attitude-wrap' });
      const attitudeSlider = sliderField({
        label: '对他的态度',
        value: attitudeOf(draft),
        left: '冷漠 / 不理睬',
        right: '热情 / 亲近',
        step: 5,
        describe: describeAttitude,
        onChange: (v) => {
          draft.attitude = v;
        },
      });
      modeRow.append(attitudeSlider);

      const idList = el('div', { class: 'openid-list' });
      for (const o of draft.openids || []) {
        idList.append(
          el(
            'div',
            { class: 'openid-row' },
            el(
              'div',
              { class: 'flex-1' },
              el('div', { class: 'mono-num small truncate', title: o.openid }, o.openid),
              el(
                'div',
                { class: 'small muted' },
                o.scope === 'c2c' ? '单聊身份' : `群内身份${o.groupId ? ` · ${String(o.groupId).slice(0, 10)}…` : ''}`,
                o.name ? ` · 昵称「${o.name}」` : ' · 未提供昵称',
                o.lastAt ? ` · 最近 ${timeAgo(o.lastAt)}` : '',
              ),
            ),
            el(
              'button',
              {
                class: 'btn btn-sm btn-ghost btn-danger',
                type: 'button',
                title: '解除绑定',
                onclick: async () => {
                  try {
                    await api.del(`/api/people/${person.id}/openids/${encodeURIComponent(o.openid)}`);
                    await reload();
                    toast('已解除绑定', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('x', 12),
            ),
          ),
        );
      }
      if (!(draft.openids || []).length) {
        idList.append(el('div', { class: 'small muted', style: 'padding:8px 0' }, '还没有绑定任何身份标识，这样名单不会生效。'));
      }

      detailHost.append(
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'card-head' },
            el('h2', {}, person.alias || '未命名'),
            el('span', { class: `tag ${tab === 'whitelist' ? 'green' : 'red'}` }, tab === 'whitelist' ? '白名单' : '黑名单'),
          ),
          el(
            'div',
            { class: 'card-body' },
            el(
              'div',
              { class: 'row' },
              el('div', {}, field('备注名', aliasInput, '只影响控制台显示。')),
              el('div', {}, field('备注', noteInput)),
            ),
            field('QQ 号', qqInput, '选填。只作为你自己的备注，官方接口不返回 QQ 号，匹配一律靠下面的 openid。'),
            modeRow,
            el(
              'div',
              { class: 'field' },
              el('label', {}, `绑定的身份标识（${(draft.openids || []).length}）`),
              idList,
              el(
                'button',
                {
                  class: 'btn btn-sm mt-8',
                  type: 'button',
                  onclick: () => pickIdentity(person, reload),
                },
                icon('plus', 13),
                '绑定一个见过的身份',
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
                    await api.put(`/api/people/${person.id}`, {
                      alias: draft.alias,
                      note: draft.note,
                      qq: draft.qq,
                      attitude: draft.attitude,
                    });
                    await reload();
                    toast('已保存', 'ok');
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
                  const yes = await confirmDialog({
                    title: `把「${person.alias || '这个人'}」移出名单？`,
                    message: '移出后机器人会恢复默认态度，历史记录不受影响。',
                    confirmText: '移出',
                    danger: true,
                  });
                  if (!yes) return;
                  try {
                    await api.del(`/api/people/${person.id}`);
                    selectedId = null;
                    await reload();
                    toast('已移出名单', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              icon('trash', 14),
              '移出名单',
            ),
          ),
        ),
      );
    }

    /* --------------------------------------------------- 见过的身份 */

    function renderRecent() {
      clear(recentHost);
      // 只列出真的聊起来过的人（默认 ≥3 条），避免把只冒过一句的人全堆上来
      const candidates = identities.filter((i) => !i.listTag && (i.count || 0) >= MIN_MESSAGES);
      const quiet = identities.filter((i) => !i.listTag && (i.count || 0) < MIN_MESSAGES).length;

      if (!candidates.length) {
        recentHost.append(
          el(
            'div',
            { class: 'empty', style: 'padding:26px' },
            el(
              'p',
              {},
              identities.length
                ? quiet
                  ? `有 ${quiet} 个人聊过但还不到 ${MIN_MESSAGES} 条，等聊得多一点就会出现在这里。也可以用右上角「手动添加」。`
                  : '所有联系过的人都已归入名单。'
                : '还没有收到过消息。等机器人上线并有人跟它说话后，这里会自动列出对方。',
            ),
          ),
        );
        return;
      }

      for (const id of candidates) {
        const display = id.name || `用户 ${String(id.openid).slice(0, 6)}`;
        recentHost.append(
          el(
            'div',
            { class: 'identity-card' },
            el(
              'div',
              { class: 'identity-head' },
              avatarFor(id.openid, display),
              el(
                'div',
                { class: 'flex-1' },
                el('b', { class: 'truncate' }, display),
                el('span', { class: 'small muted' }, id.scope === 'c2c' ? '单聊' : '群聊', ` · ${id.count} 条消息`),
              ),
            ),
            el('div', { class: 'mono-num small muted truncate', title: id.openid }, id.openid),
            el(
              'div',
              { class: 'row-inline mt-8' },
              el(
                'button',
                {
                  class: 'btn btn-sm',
                  type: 'button',
                  onclick: () => quickAdd(id, 'whitelist'),
                },
                '加入白名单',
              ),
              el(
                'button',
                {
                  class: 'btn btn-sm btn-danger',
                  type: 'button',
                  onclick: () => quickAdd(id, 'blacklist'),
                },
                '加入黑名单',
              ),
            ),
          ),
        );
      }
    }

    async function quickAdd(identity, listTag) {
      try {
        await api.post('/api/people/quick', {
          openid: identity.openid,
          listTag,
          alias: identity.name || '',
          scope: identity.scope || '',
          groupId: identity.groupId || '',
          name: identity.name || '',
        });
        tab = listTag;
        await reload();
        toast(listTag === 'whitelist' ? '已加入白名单' : '已加入黑名单', 'ok');
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    /** 从见过的身份里挑一个，绑到指定的人身上 */
    function pickIdentity(person, done) {
      const bound = new Set((person.openids || []).map((o) => String(o.openid)));
      const candidates = identities.filter((i) => !bound.has(String(i.openid)));
      const box = el('div', { class: 'identity-grid' });

      if (!candidates.length) {
        box.append(el('div', { class: 'empty', style: 'padding:20px' }, el('p', {}, '没有其他见过的身份可以绑定。')));
      }
      for (const id of candidates.slice(0, 60)) {
        box.append(
          el(
            'div',
            { class: 'identity-card' },
            el('b', { class: 'truncate' }, id.name || '（未提供昵称）'),
            el('span', { class: 'small muted' }, id.scope === 'c2c' ? '单聊身份' : '群内身份'),
            el('div', { class: 'mono-num small muted truncate', title: id.openid }, id.openid),
            el(
              'button',
              {
                class: 'btn btn-sm btn-primary mt-8',
                type: 'button',
                onclick: async () => {
                  try {
                    await api.post(`/api/people/${person.id}/openids`, {
                      openid: id.openid,
                      scope: id.scope || '',
                      groupId: id.groupId || '',
                      name: id.name || '',
                    });
                    handle.close();
                    await done();
                    toast('已绑定', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              id.listTag ? `已属于${id.listTag === 'whitelist' ? '白' : '黑'}名单，仍要绑定` : '绑定',
            ),
          ),
        );
      }

      const handle = openModal({
        title: '绑定一个见过的身份',
        wide: true,
        body: el(
          'div',
          {},
          el('p', { class: 'small muted mt-0' }, '同一个人在单聊和各群里是不同的 openid。把要一并对待的身份都绑到这个人身上。'),
          box,
        ),
        footer: [el('button', { class: 'btn', type: 'button', onclick: () => handle.close() }, '关闭')],
      });
    }

    /* ------------------------------------------------------------ 加载 */

    async function reload() {
      [people, identities] = await Promise.all([api.get('/api/people'), api.get('/api/identities')]);
      if (selectedId && !people.some((p) => p.id === selectedId)) selectedId = null;
      if (!selectedId && inTab().length) selectedId = inTab()[0].id;
      renderTabs();
      renderList();
      renderDetail();
      renderRecent();
      await ctx.refresh();
    }

    /* ------------------------------------------- 手动添加（不依赖最近联系人） */

    function openManualAdd() {
      const draft = { alias: '', qq: '', openid: '', listTag: tab, attitude: tab === 'blacklist' ? 5 : 80 };

      const aliasInput = el('input', { class: 'input', placeholder: '例如：老王', oninput: (e) => (draft.alias = e.target.value) });
      const qqInput = el('input', {
        class: 'input mono-num',
        placeholder: '选填，例如 10001',
        inputmode: 'numeric',
        oninput: (e) => {
          draft.qq = e.target.value.replace(/\D/g, '').slice(0, 12);
          e.target.value = draft.qq;
        },
      });
      const openidInput = el('input', {
        class: 'input mono',
        placeholder: '粘贴对方的 openid',
        oninput: (e) => (draft.openid = e.target.value.trim()),
      });

      const tagPicker = el('div', { class: 'segmented' });
      for (const t of TABS) {
        const btn = el(
          'button',
          {
            type: 'button',
            'aria-pressed': String(draft.listTag === t.tag),
            onclick: () => {
              draft.listTag = t.tag;
              for (const other of tagPicker.children) other.setAttribute('aria-pressed', 'false');
              btn.setAttribute('aria-pressed', 'true');
            },
          },
          t.label,
        );
        tagPicker.append(btn);
      }

      const err = el('div', { class: 'small', style: 'color:var(--qq-red);min-height:18px' });

      const handle = openModal({
        title: '手动添加名单成员',
        body: el(
          'div',
          {},
          el(
            'div',
            { class: 'row' },
            el('div', {}, field('备注名', aliasInput)),
            el('div', {}, field('QQ 号', qqInput, '只作为你自己的备注。官方接口不返回 QQ 号，所以它不参与匹配。')),
          ),
          field('openid', openidInput, '真正用来匹配身份。可以在「消息日志」里点开对方复制他的 openid。'),
          field('加入哪份名单', tagPicker),
          sliderField({
            label: '对他的态度',
            value: draft.attitude,
            left: '冷漠 / 不理睬',
            right: '热情 / 亲近',
            step: 5,
            describe: describeAttitude,
            onChange: (v) => {
              draft.attitude = v;
            },
          }),
          err,
        ),
        footer: [
          el('button', { class: 'btn', type: 'button', onclick: () => handle.close() }, '取消'),
          el(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              onclick: async (e) => {
                if (!draft.openid) {
                  err.textContent = 'openid 是必填的：没有它就无法匹配到这个人。';
                  return;
                }
                e.target.disabled = true;
                try {
                  await api.post('/api/people', {
                    alias: draft.alias,
                    qq: draft.qq,
                    listTag: draft.listTag,
                    attitude: draft.attitude,
                    openids: [{ openid: draft.openid, scope: 'manual' }],
                  });
                  handle.close();
                  await reload();
                  toast(`已加入${draft.listTag === 'blacklist' ? '黑' : '白'}名单`, 'ok');
                } catch (err2) {
                  err.textContent = err2.message;
                } finally {
                  e.target.disabled = false;
                }
              },
            },
            '添加',
          ),
        ],
      });
    }

    /* ------------------------------------------------------------ 页面 */

    mount(
      host,
      el('div', { class: 'page-head' }, el('h1', {}, '名单表')),

      el(
        'div',
        { class: 'notice' },
        icon('info', 14),
        el(
          'span',
          {},
          el('strong', {}, '为什么名单按 openid 而不是 QQ 号？'),
          '官方接口不返回 QQ 号（运营规范也明确禁止获取），消息里能拿到的只有 openid。openid 反而更适合认人——',
          '对方改昵称、换头像都不会变，不会出现「改个名字就认错人」。手动添加时填的 QQ 号只当备注留档，真正参与匹配的是 openid。',
        ),
      ),

      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, tabBar, el('span', { class: 'spacer' }), countLabel),
        el(
          'div',
          { class: 'card-body' },
          el(
            'div',
            { class: 'split' },
            el('div', { class: 'list-pane' }, listHost),
            detailHost,
          ),
        ),
      ),

      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card-head' },
          el('h2', {}, '最近联系过的人'),
          el('span', { class: 'hint' }, `聊满 ${MIN_MESSAGES} 条以上的人会自动出现在这里`),
          el(
            'button',
            { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => openManualAdd() },
            icon('plus', 13),
            '手动添加',
          ),
          el(
            'button',
            { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => reload() },
            icon('refresh', 13),
            '刷新',
          ),
        ),
        el('div', { class: 'card-body' }, recentHost),
      ),
    );

    renderTabs();
    renderList();
    renderDetail();
    renderRecent();

    const onEvent = (e) => {
      if (e.detail.type === 'message') reload().catch(() => {});
    };
    window.addEventListener('console:event', onEvent);
    return () => window.removeEventListener('console:event', onEvent);
  },
};
