import QRCode from 'qrcode';
import { hub } from '../hub.js';
import { activateBot, activeBot, activeBotId, config, createBot, updateBotProfile } from '../data.js';
import { getMe } from './api.js';
import { gateway } from './gateway.js';

/**
 * 第三方 Agent 扫码接入。
 * 使用官方 SDK @tencent-connect/qqbot-connector：
 * 在控制台展示二维码 → 用户用手机 QQ 扫码 → 自动拿到 AppID / AppSecret。
 * 文档：https://bot.q.qq.com/wiki/agent-qqbot/#第三方-agent-接入
 */

let state = {
  status: 'idle', // idle | pending | expired | success | error
  url: '',
  dataUrl: '',
  appId: '',
  message: '',
  startedAt: 0,
};

let dispose = null;
let startQrConnect = null;
let loaderError = '';

async function loadSdk() {
  if (startQrConnect) return startQrConnect;
  if (loaderError) throw new Error(loaderError);
  try {
    const mod = await import('@tencent-connect/qqbot-connector');
    startQrConnect = mod.startQrConnect;
    return startQrConnect;
  } catch (err) {
    loaderError = `扫码 SDK 加载失败：${err.message}`;
    throw new Error(loaderError);
  }
}

async function toDataUrl(url) {
  try {
    return await QRCode.toDataURL(url, {
      width: 380,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });
  } catch {
    return '';
  }
}

export function qrState() {
  return { ...state };
}

export function cancelQr() {
  if (dispose) {
    try {
      dispose();
    } catch {
      /* 忽略 */
    }
    dispose = null;
  }
  if (state.status === 'pending' || state.status === 'expired') {
    state = { ...state, status: 'idle', message: '已取消扫码' };
    hub.broadcast('qr', qrState());
  }
  return qrState();
}

export async function beginQrConnect() {
  cancelQr();
  const sdk = await loadSdk();

  state = {
    status: 'pending',
    url: '',
    dataUrl: '',
    appId: '',
    message: '正在生成二维码…',
    startedAt: Date.now(),
  };
  hub.broadcast('qr', qrState());

  dispose = sdk(
    {
      onQrDisplayed: async (url) => {
        const dataUrl = await toDataUrl(url);
        state = { ...state, status: 'pending', url, dataUrl, message: '请用手机 QQ 扫码并选择要绑定的机器人' };
        hub.broadcast('qr', qrState());
        hub.log('info', 'connect', '二维码已生成，等待手机 QQ 扫码');
      },
      onQrExpired: () => {
        state = { ...state, status: 'expired', message: '二维码已过期，正在自动刷新…' };
        hub.broadcast('qr', qrState());
        hub.log('warn', 'connect', '二维码已过期，等待自动刷新');
      },
      onSuccess: async (credentials) => {
        const list = Array.isArray(credentials) ? credentials : [credentials];
        const first = list[0] || {};
        dispose = null;

        if (!first.appId || !first.appSecret) {
          state = { ...state, status: 'error', message: '扫码成功但未返回有效凭据' };
          hub.log('error', 'connect', '扫码成功但未返回有效凭据');
          hub.broadcast('qr', qrState());
          return;
        }

        const appId = String(first.appId);
        const appSecret = String(first.appSecret);
        const current = activeBot();

        // 扫到的是另一台机器人 → 新建一份独立档案并切过去；
        // 同一台则就地更新凭据。这样每台机器人的调教内容互不干扰。
        let targetBotId = activeBotId();
        let createdNew = false;
        if (current.appId && current.appId !== appId) {
          gateway.stop();
          const bot = createBot({ name: `机器人 ${appId.slice(0, 6)}`, source: 'qr', appId });
          targetBotId = bot.id;
          createdNew = true;
          // createBot 之后 activeId 还没变，先写好凭据再切换
          updateBotProfile(bot.id, { appId });
        }

        config.patch({ appId, appSecret, updatedAt: Date.now() });

        // 顺手从平台读回真实昵称与头像，侧边栏就能显示机器人本来的样子
        try {
          const me = await getMe();
          if (me?.username) updateBotProfile(targetBotId, { name: me.username });
          if (me?.avatar) updateBotProfile(targetBotId, { avatar: me.avatar });
          hub.log('ok', 'connect', `已读取平台资料：${me?.username || appId}`);
        } catch {
          /* 读不到不影响绑定 */
        }

        if (createdNew) {
          activateBot(targetBotId);
          hub.broadcast('bots:changed', { activeId: targetBotId });
          hub.log('ok', 'connect', '已在新的机器人档案下完成绑定');
        }

        state = {
          ...state,
          status: 'success',
          appId,
          botId: targetBotId,
          botName: activeBot().name,
          message: createdNew ? '绑定成功，已新建一份独立档案' : '绑定成功，已自动写入接入配置',
          autoStarted: false,
        };
        hub.log('ok', 'connect', `扫码绑定成功，AppID ${appId}`);
        hub.broadcast('qr', qrState());
        hub.broadcast('config:changed', config.get());
        hub.broadcast('bots:changed', { activeId: activeBotId() });

        // 绑定完成后按设置自动上线
        if (config.get().autoStartAfterBind) {
          setTimeout(() => {
            hub.log('info', 'connect', '绑定成功，正在自动启动机器人…');
            gateway
              .start()
              .then(() => hub.broadcast('qr', { ...qrState(), autoStarted: true }))
              .catch((err) => hub.log('error', 'gateway', `自动启动失败：${err.message}`));
          }, 600);
        }
      },
      onFailure: (error) => {
        dispose = null;
        state = { ...state, status: 'error', message: error?.message || '扫码失败' };
        hub.log('error', 'connect', `扫码失败：${state.message}`);
        hub.broadcast('qr', qrState());
      },
    },
    { displayQrCodeToConsole: false, source: 'QQ机器人控制台' },
  );

  return qrState();
}
