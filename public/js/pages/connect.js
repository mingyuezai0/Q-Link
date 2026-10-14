import { api } from '../api.js';
import { el, icon, mount, clear, toast, field, confirmDialog } from '../ui.js';
import { applyStatus, loadState } from '../app.js';

const INTENT_LABELS = {
  GUILDS: ['频道基础事件', 'GUILD / CHANNEL 的创建、更新、删除'],
  GUILD_MEMBERS: ['频道成员变动', '成员加入、更新、离开'],
  GUILD_MESSAGES: ['频道全量消息', '仅私域机器人可用'],
  DIRECT_MESSAGE: ['频道私信', '用户私信机器人（不支持沙箱）'],
  GROUP_AND_C2C_EVENT: ['单聊 + 群聊消息', '含 C2C 单聊、群 @ 机器人、群全量消息，必选'],
  INTERACTION: ['按钮交互', '用户点击消息里的按钮、快捷菜单'],
  MESSAGE_AUDIT: ['消息审核结果', '主动消息的审核通过 / 拒绝通知'],
  PUBLIC_GUILD_MESSAGES: ['频道 @ 消息', 'AT_MESSAGE_CREATE，基础权限'],
};

export default {
  async render(host, ctx) {
    const [config, intents, status] = await Promise.all([
      api.get('/api/config'),
      api.get('/api/intents'),
      api.get('/api/status'),
    ]);

    const draft = structuredClone(config);
    let qr = await api.get('/api/qr').catch(() => ({ status: 'idle' }));

    /* ------------------------------------------------------- 扫码面板 */

    const qrFrame = el('div', { class: 'qr-frame' });
    const qrTip = el('div', { class: 'qr-tip' });
    const qrActions = el('div', { class: 'row-inline', style: 'justify-content:center' });

    function renderQr() {
      clear(qrFrame);
      qrFrame.classList.toggle('expired', qr.status === 'expired');
      if (qr.dataUrl) {
        qrFrame.append(el('img', { src: qr.dataUrl, alt: 'QQ 机器人绑定二维码', width: 190, height: 190 }));
      } else {
        qrFrame.append(
          el(
            'div',
            { style: 'width:190px;height:190px;display:grid;place-items:center;color:var(--ink-3)' },
            icon('qr', 46),
          ),
        );
      }

      if (qr.status === 'success') {
        qrTip.innerHTML = `绑定成功，AppID <b>${qr.appId}</b> 已写入配置${qr.botName ? `，当前机器人「${qr.botName}」` : ''}。`;
      } else if (qr.status === 'pending') {
        qrTip.innerHTML = '打开手机 QQ 扫码，选择要绑定的机器人，确认后凭据会<b>自动写入</b>这里的配置。';
      } else if (qr.status === 'error') {
        qrTip.textContent = qr.message || '扫码失败，请重试';
      } else if (qr.status === 'expired') {
        qrTip.textContent = '二维码已过期，正在自动刷新…';
      } else {
        qrTip.textContent = '生成二维码后，用手机 QQ 扫码即可自动获取 AppID 与 AppSecret，不用手动复制。';
      }

      clear(qrActions);
      if (qr.status === 'pending' || qr.status === 'expired') {
        qrActions.append(
          el(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                qr = await api.post('/api/qr/cancel');
                renderQr();
              },
            },
            '取消',
          ),
        );
      } else {
        qrActions.append(
          el(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              onclick: async (e) => {
                e.target.disabled = true;
                try {
                  qr = await api.post('/api/qr/start');
                  renderQr();
                } catch (err) {
                  toast(err.message, 'error');
                } finally {
                  e.target.disabled = false;
                }
              },
            },
            icon('qr', 14),
            '生成二维码',
          ),
        );
      }
    }
    renderQr();

    /* ------------------------------------------------------- 手动配置 */

    const appIdInput = el('input', {
      class: 'input mono',
      placeholder: '例如 1029xxxxxx',
      value: draft.appId || '',
      oninput: (e) => (draft.appId = e.target.value.trim()),
    });
    const secretInput = el('input', {
      class: 'input mono',
      type: 'password',
      placeholder: '在开放平台「开发设置」里重置后复制',
      value: draft.appSecret || '',
      oninput: (e) => (draft.appSecret = e.target.value.trim()),
    });
    const revealBtn = el(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          const hidden = secretInput.type === 'password';
          secretInput.type = hidden ? 'text' : 'password';
          revealBtn.textContent = hidden ? '隐藏' : '显示';
        },
      },
      '显示',
    );

    const baseUrlInput = el('input', {
      class: 'input mono',
      placeholder: '留空使用官方默认域名',
      value: draft.baseUrl || '',
      oninput: (e) => (draft.baseUrl = e.target.value.trim()),
    });

    /* ------------------------------------------------------- Intents */

    const intentSum = el('span', { class: 'tag blue mono' });
    const intentRows = el('div', { class: 'grid grid-2' });

    function renderIntentSum() {
      intentSum.textContent = `intents = ${draft.intents}（0x${Number(draft.intents).toString(16)}）`;
    }

    for (const [name, value] of Object.entries(intents)) {
      const [title, desc] = INTENT_LABELS[name] || [name, ''];
      const checked = (draft.intents & value) === value;
      intentRows.append(
        el(
          'label',
          {
            style:
              'display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border:1px solid var(--line);border-radius:8px;cursor:pointer',
          },
          el('input', {
            type: 'checkbox',
            checked,
            style: 'margin-top:3px',
            onchange: (e) => {
              draft.intents = e.target.checked ? draft.intents | value : draft.intents & ~value;
              renderIntentSum();
            },
          }),
          el(
            'span',
            { class: 'flex-1' },
            el('span', { style: 'font-weight:600;display:block' }, title),
            el('span', { class: 'small muted', style: 'display:block' }, desc || '—'),
            el('span', { class: 'tag mono', style: 'margin-top:4px' }, `1<<${Math.log2(value)} = ${value}`),
          ),
        ),
      );
    }
    renderIntentSum();

    /* --------------------------------------------------- 平台权限：本机可控制 */

    // 这三项在本机真的生效：私聊/群聊不响应，频道记录偏好
    const localToggle = (key, title, desc) => {
      const input = el('input', {
        type: 'checkbox',
        checked: draft.reply[key] !== false,
        onchange: async (e) => {
          draft.reply[key] = e.target.checked;
          try {
            await api.put('/api/config', { reply: draft.reply });
            toast(e.target.checked ? `已允许：${title}` : `已禁止：${title}`, 'ok');
          } catch (err) {
            e.target.checked = !e.target.checked;
            draft.reply[key] = e.target.checked;
            toast(err.message, 'error');
          }
        },
      });
      return el(
        'div',
        { class: 'perm-row' },
        el('div', { class: 'perm-main' }, el('b', {}, title), el('span', { class: 'small muted' }, desc)),
        el('label', { class: 'switch' }, input, el('span', { class: 'track' })),
      );
    };

    const localSwitches = [
      localToggle('privateEnabled', '允许其他用户与机器人私聊', '关闭后，机器人不再响应任何单聊消息（平台上谁能私聊它还受「服务范围」和「内部体验号码」限制）。'),
      localToggle('groupEnabled', '允许机器人在群聊中交流', '关闭后，机器人不再响应任何群消息，包括 @ 它的。'),
      localToggle('channelEnabled', '允许在文字子频道（频道）内使用', '记录这项偏好；频道回复本身尚未实现，实际能否在频道内使用由频道的接口授权决定。'),
    ];

    /* ------------------------------------------- 群内真实状态（从平台读） */

    const groupStateBox = el('div', { class: 'group-state-box' });

    const ROLE_LABEL = { owner: '群主', admin: '管理员', member: '普通成员' };
    const RECV_LABEL = {
      all: '接收全部消息',
      only_mention: '仅 @ 机器人',
      mention_and_context: '@ 机器人与被引用',
    };

    function renderGroupStates(result) {
      clear(groupStateBox);
      const groups = result?.groups || [];
      if (!groups.length) {
        groupStateBox.append(el('div', { class: 'small muted', style: 'padding:10px 12px' }, result?.note || '没有可读取的群聊。'));
        return;
      }
      for (const g of groups) {
        if (!g.ok) {
          groupStateBox.append(
            el(
              'div',
              { class: 'group-state-row' },
              el('div', { class: 'perm-main' }, el('b', {}, g.name), el('span', { class: 'small muted' }, g.error)),
              el('span', { class: 'tag amber' }, '读不到'),
            ),
          );
          continue;
        }
        const isAdmin = g.memberRole === 'admin' || g.memberRole === 'owner';
        groupStateBox.append(
          el(
            'div',
            { class: 'group-state-row' },
            el(
              'div',
              { class: 'perm-main' },
              el('b', {}, g.name),
              el(
                'span',
                { class: 'row-inline', style: 'margin-top:4px' },
                el('span', { class: `tag ${isAdmin ? 'green' : ''}` }, `机器人身份：${ROLE_LABEL[g.memberRole] || g.memberRole || '未知'}`),
                el('span', { class: 'tag blue' }, RECV_LABEL[g.recvMsgSetting] || g.recvMsgSetting || '未知'),
                el('span', { class: `tag ${g.allowProactiveMsg ? 'green' : ''}` }, g.allowProactiveMsg ? '可主动推送' : '不可主动推送'),
              ),
            ),
          ),
        );
      }
      groupStateBox.append(
        el(
          'div',
          { class: 'small muted', style: 'padding:8px 12px' },
          isAnyAdmin(groups)
            ? '机器人已是管理员，群管理能力（撤回成员消息等）可用。'
            : '机器人还不是群管理员。让它变成管理员只能在手机 QQ 里由群主操作，没有接口可以授予。',
        ),
      );
    }

    const isAnyAdmin = (groups) => groups.some((g) => g.ok && (g.memberRole === 'admin' || g.memberRole === 'owner'));

    /* ------------------------------------------- 频道接口权限授权链接 */

    const guildInput = el('input', { class: 'input mono', placeholder: 'guild_id', style: 'width:180px' });
    const guildBtn = el(
      'button',
      {
        class: 'btn btn-sm',
        type: 'button',
        onclick: async (e) => {
          const guildId = guildInput.value.trim();
          if (!guildId) return toast('请先填写频道 ID', 'error');
          e.target.disabled = true;
          clear(guildResultBox);
          try {
            const r = await api.post('/api/platform/channel-authorize', { guildId });
            if (r.url) {
              guildResultBox.append(
                el(
                  'div',
                  { class: 'notice' },
                  icon('check', 14),
                  el(
                    'span',
                    {},
                    '授权链接已生成（每天每个频道最多 3 条）。把它发给频道主，由对方点击授权：',
                    el('br'),
                    el('a', { href: r.url, target: '_blank', rel: 'noreferrer', class: 'mono' }, r.url),
                  ),
                ),
              );
            } else {
              guildResultBox.append(
                el('div', { class: 'notice warn' }, icon('alert', 14), el('span', {}, `接口已返回，但没有 url 字段：${JSON.stringify(r.raw).slice(0, 160)}`)),
              );
            }
          } catch (err) {
            guildResultBox.append(el('div', { class: 'notice danger' }, icon('alert', 14), el('span', {}, err.message)));
          } finally {
            e.target.disabled = false;
          }
        },
      },
      '生成授权链接',
    );
    const guildResultBox = el('div', {});

    /* ------------------------------------------------------- 页面 */

    mount(
      host,
      el('div', { class: 'page-head' }, el('h1', {}, '接入配置')),

      el(
        'div',
        { class: 'grid grid-2' },
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'card-head' }, el('h2', {}, '扫码绑定'), el('span', { class: 'hint' }, '推荐，免手抄')),
          el(
            'div',
            { class: 'card-body' },
            el(
              'div',
              { class: 'qr-stage' },
              qrFrame,
              qrTip,
              qrActions,
              el(
                'div',
                { class: 'notice', style: 'margin-top:6px;text-align:left' },
                icon('info', 14),
                el(
                  'span',
                  {},
                  '扫码页面默认显示为「第三方机器人」。扫码成功后 AppID 与 AppSecret 会直接写入下方配置，可立即启动。',
                ),
              ),
            ),
          ),
        ),

        el(
          'div',
          { class: 'card' },
          el('div', { class: 'card-head' }, el('h2', {}, '手动填写')),
          el(
            'div',
            { class: 'card-body' },
            field('AppID', appIdInput, '在 QQ 开放平台 → 机器人 → 开发设置 中查看。'),
            field(
              'AppSecret',
              el('div', { class: 'row-inline', style: 'gap:8px' }, el('span', { class: 'flex-1' }, secretInput), revealBtn),
              '仅保存在本机 data/config.json，不会上传到任何第三方。',
            ),
            field('接口域名', baseUrlInput, '默认 https://api.bot.qq.com；沙箱环境会自动切换为沙箱域名，也可在此覆盖。'),
            el(
              'label',
              { class: 'switch' },
              el('input', {
                type: 'checkbox',
                checked: Boolean(draft.sandbox),
                onchange: (e) => (draft.sandbox = e.target.checked),
              }),
              el('span', { class: 'track' }),
              el('span', { class: 'switch-label' }, '使用沙箱环境（调试用，需在开放平台单独配置沙箱机器人）'),
            ),
            el('div', { class: 'mt-12' }),
            el(
              'label',
              { class: 'switch' },
              el('input', {
                type: 'checkbox',
                checked: Boolean(draft.autoConnect),
                onchange: (e) => (draft.autoConnect = e.target.checked),
              }),
              el('span', { class: 'track' }),
              el('span', { class: 'switch-label' }, '控制台启动时自动连接机器人'),
            ),
            el('div', { class: 'mt-12' }),
            el(
              'label',
              { class: 'switch' },
              el('input', {
                type: 'checkbox',
                checked: draft.autoStartAfterBind !== false,
                onchange: (e) => (draft.autoStartAfterBind = e.target.checked),
              }),
              el('span', { class: 'track' }),
              el('span', { class: 'switch-label' }, '扫码绑定成功后自动启动机器人'),
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
                    await api.put('/api/config', draft);
                    await loadState();
                    toast('接入配置已保存', 'ok');
                  } catch (err) {
                    toast(err.message, 'error');
                  } finally {
                    e.target.disabled = false;
                  }
                },
              },
              icon('save', 14),
              '保存配置',
            ),
            el(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: async (e) => {
                  e.target.disabled = true;
                  try {
                    const r = await api.post('/api/config/test');
                    toast(`鉴权成功：${r.bot?.username || r.bot?.id || '机器人'}`, 'ok', 4000);
                    await ctx.refresh();
                  } catch (err) {
                    toast(`鉴权失败：${err.message}`, 'error', 6000);
                  } finally {
                    e.target.disabled = false;
                  }
                },
              },
              icon('check', 14),
              '测试连接',
            ),
            el('span', { class: 'spacer' }),
            el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => ctx.refresh() }, '重置表单'),
          ),
        ),
      ),

      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card-head' },
          el('h2', {}, '事件订阅（intents）'),
          el('span', { class: 'hint' }, '订阅了才会收到对应事件；无权限的位会导致连接被直接关闭'),
          intentSum,
        ),
        el('div', { class: 'card-body' }, intentRows),
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
                  await api.put('/api/config', { intents: draft.intents });
                  toast('已保存事件订阅，重启连接后生效', 'ok', 3600);
                } catch (err) {
                  toast(err.message, 'error');
                } finally {
                  e.target.disabled = false;
                }
              },
            },
            '保存事件订阅',
          ),
          el(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () =>
                confirmDialog({
                  title: '恢复推荐订阅？',
                  message: '将订阅「单聊 + 群聊消息」与「按钮交互」两项，这是接入 QQ 机器人最常用的组合。',
                  confirmText: '恢复推荐',
                }).then((yes) => {
                  if (!yes) return;
                  draft.intents = intents.GROUP_AND_C2C_EVENT | intents.INTERACTION;
                  renderIntentSum();
                  ctx.refresh();
                }),
            },
            '恢复推荐组合',
          ),
        ),
      ),

      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card-head' },
          el('h2', {}, '平台权限'),
          el('span', { class: 'hint' }, '这几项在 QQ 开放平台 / QQ 客户端里设置，官方没有提供写接口'),
        ),
        el(
          'div',
          { class: 'card-body' },
          el('div', { class: 'perm-section-title' }, el('span', { class: 'tag green' }, '本机可控制'), el('span', { class: 'small muted' }, '改动即时生效，只影响这台机器人本机的行为')),
          ...localSwitches,
          el('div', { class: 'perm-section-title', style: 'margin-top:16px' }, el('span', { class: 'tag amber' }, '只能读 / 只能去平台设置')),

          /* 群管理能力：读平台的真实状态 */
          el(
            'div',
            { class: 'perm-row' },
            el(
              'div',
              { class: 'perm-main' },
              el('b', {}, '允许机器人使用群管理能力'),
              el(
                'span',
                { class: 'small muted' },
                '「设为群管理员」只能由群主在手机 QQ 里操作，没有接口可以授予。但机器人是否已是管理员、群主给了多大的消息接收范围，是可以从平台读回来的。',
              ),
            ),
            el(
              'button',
              {
                class: 'btn btn-sm',
                type: 'button',
                onclick: async (e) => {
                  e.target.disabled = true;
                  try {
                    const r = await api.get('/api/platform/groups');
                    renderGroupStates(r);
                  } catch (err) {
                    toast(err.message, 'error');
                  } finally {
                    e.target.disabled = false;
                  }
                },
              },
              icon('refresh', 13),
              '读取群内真实状态',
            ),
          ),
          groupStateBox,

          /* 被搜索到：无接口 */
          el(
            'div',
            { class: 'perm-row' },
            el(
              'div',
              { class: 'perm-main' },
              el('b', {}, '允许被其他人搜索到'),
              el(
                'span',
                { class: 'small muted' },
                '在 QQ Bot 管理端的「服务范围」里设置，并受主体认证等级限制（未认证仅管理员可用 / 个人认证可公开、进群上限 500 / 企业认证全部场景）。接口索引里没有任何可读或可写这一状态的接口。',
              ),
            ),
            el(
              'a',
              { class: 'btn btn-sm', href: 'https://q.qq.com/#/apps', target: '_blank', rel: 'noreferrer' },
              '去管理端设置 ↗',
            ),
          ),

          /* 频道权限：官方唯一方式是生成授权链接 */
          el(
            'div',
            { class: 'perm-row' },
            el(
              'div',
              { class: 'perm-main' },
              el('b', {}, '频道（文字子频道）接口权限'),
              el(
                'span',
                { class: 'small muted' },
                '机器人无法自行开启频道权限。官方唯一支持的方式是生成一条授权链接，由频道主点击授权。',
              ),
            ),
            el('span', { class: 'row-inline' }, guildInput, guildBtn),
          ),
          guildResultBox,
        ),
      ),

      el(
        'div',
        { class: 'notice' },
        icon('info', 14),
        el(
          'span',
          {},
          el('strong', {}, '关于环境：'),
          '当前接口域名 ',
          el('code', { class: 'mono' }, status.baseUrl || config.apiBase || ''),
          '。若连接被拒绝且提示 intents 无权限，说明该事件需要在 QQ 开放平台单独申请。',
        ),
      ),
    );

    /* 扫码状态实时更新 */
    const onEvent = (e) => {
      if (e.detail.type !== 'qr') return;
      qr = e.detail.payload;
      renderQr();
      if (qr.status === 'success') {
        toast(`绑定成功，AppID ${qr.appId}`, 'ok', 4000);
        ctx.refresh();
      }
    };
    window.addEventListener('console:event', onEvent);
    return () => window.removeEventListener('console:event', onEvent);
  },
};
