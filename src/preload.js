'use strict';
const { contextBridge, ipcRenderer, webFrame } = require('electron');
const { marked } = require('marked');
const hljs = require('highlight.js');

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 代码块：highlight.js 按 VS Code Dark+ 配色着色；未知语言则原样转义
const renderer = {
  code({ text, lang }) {
    let out;
    let cls = 'hljs';
    const name = (lang || '').trim().split(/\s+/)[0].toLowerCase();
    if (name && hljs.getLanguage(name)) {
      try {
        out = hljs.highlight(text, { language: name, ignoreIllegals: true }).value;
        cls += ' language-' + name;
      } catch {
        out = escapeHtml(text);
      }
    } else {
      out = escapeHtml(text);
      if (name) cls += ' language-' + name;
    }
    return `<pre><code class="${cls}">${out}\n</code></pre>`;
  }
};

marked.use({
  gfm: true,
  breaks: true,
  renderer
});

contextBridge.exposeInMainWorld('mdv', {
  // ---- markdown ----
  renderMarkdown: (text) => marked.parse(text, { async: false }),
  headingMeta: (html) => null,

  // ---- files ----
  readFile: (p) => ipcRenderer.invoke('mdv:read-file', p),
  openFileDialog: () => ipcRenderer.invoke('mdv:open-dialog'),
  listDir: (p) => ipcRenderer.invoke('mdv:list-dir', p),
  showInFolder: (p) => ipcRenderer.invoke('mdv:show-in-folder', p),
  openExternal: (u) => ipcRenderer.invoke('mdv:open-external', u),
  openPath: (p) => ipcRenderer.invoke('mdv:open-path', p),

  // ---- events ----
  onOpenFile: (cb) => ipcRenderer.on('mdv:open-file', (_e, p) => cb(p)),
  onMenu: (cb) => ipcRenderer.on('mdv:menu', (_e, cmd) => cb(cmd)),
  onZoom: (cb) => ipcRenderer.on('mdv:zoom', (_e, cmd) => cb(cmd)),

  // ---- zoom ----
  setZoom: (f) => { webFrame.setZoomFactor(f); },
  getZoom: () => webFrame.getZoomFactor(),

  // ---- theme ----
  applyTheme: (t) => ipcRenderer.send('mdv:theme', t)
});
