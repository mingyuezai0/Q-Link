/**
 * 桌面外壳的预加载脚本。
 *
 * 只暴露必要的能力，渲染进程拿不到 Node，也拿不到任意 IPC 通道。
 * 页面通过 window.qlink 判断自己是不是跑在桌面外壳里。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qlink', {
  desktop: true,
  platform: process.platform,

  /** 通知主进程切换外壳配色（标题栏按钮区、窗口底色） */
  setTheme: (mode) => ipcRenderer.send('qlink:theme', mode === 'dark' ? 'dark' : 'light'),

  /** 读取外壳信息：版本号、数据目录、后端端口 */
  info: () => ipcRenderer.invoke('qlink:info'),
});
