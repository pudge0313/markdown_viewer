'use strict';
const { contextBridge, ipcRenderer, webFrame, webUtils, clipboard } = require('electron');
const { renderMarkdown } = require('./render-md');
const { normalizeWinPath, joinAndNormalize } = require('./winpath');
const mdEdit = require('./md-edit');

/** 安全的回调订阅：返回取消函数 */
function on(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('MDVEdit', mdEdit);

contextBridge.exposeInMainWorld('mdv', {
  /* ---------- 路径 ---------- */
  normalizePath: (p) => normalizeWinPath(p),
  joinPath: (dir, rel) => joinAndNormalize(dir, rel),

  /* ---------- markdown ---------- */
  renderMarkdown: (text, opts) => renderMarkdown(text, opts || {}),

  /* ---------- 文件 ---------- */
  readFile: (p) => ipcRenderer.invoke('mdv:read-file', p),
  statFile: (p) => ipcRenderer.invoke('mdv:stat-file', p),
  openFileDialog: () => ipcRenderer.invoke('mdv:open-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('mdv:open-folder'),
  listDir: (p) => ipcRenderer.invoke('mdv:list-dir', p),
  showInFolder: (p) => ipcRenderer.invoke('mdv:show-in-folder', p),
  openExternal: (u) => ipcRenderer.invoke('mdv:open-external', u),
  openPath: (p) => ipcRenderer.invoke('mdv:open-path', p),
  openInNewWindow: (p) => ipcRenderer.invoke('mdv:new-window', p),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },

  /* ---------- 外部修改监听 ---------- */
  watchFile: (p) => ipcRenderer.invoke('mdv:watch-file', p),
  unwatchFile: () => ipcRenderer.invoke('mdv:unwatch-file'),
  onFileChanged: (cb) => on('mdv:file-changed', cb),

  /* ---------- 导出 / 打印 ---------- */
  saveFile: (p, text, expectedMtime) => ipcRenderer.invoke('mdv:save-file', p, text, expectedMtime),
  exportPdf: (name) => ipcRenderer.invoke('mdv:export-pdf', name),
  printPage: () => ipcRenderer.invoke('mdv:print'),

  /* ---------- 应用信息 / 主题 ---------- */
  appInfo: () => ipcRenderer.invoke('mdv:app-info'),
  persistTheme: (t) => ipcRenderer.send('mdv:persist-theme', t),

  /* ---------- 事件 ---------- */
  onOpenFile: (cb) => on('mdv:open-file', cb),
  onMenu: (cb) => on('mdv:menu', cb),
  onSystemTheme: (cb) => on('mdv:system-theme', cb),

  /* ---------- 剪贴板 ---------- */
  copyText: (text) => { try { clipboard.writeText(String(text)); return true; } catch { return false; } },
  readText: () => { try { return clipboard.readText(); } catch { return ''; } },

  /* ---------- 缩放 ---------- */
  setZoom: (f) => { webFrame.setZoomFactor(f); },
  getZoom: () => webFrame.getZoomFactor()
});
