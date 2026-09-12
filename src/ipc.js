'use strict';
// IPC 处理器：main.js 与 tools/shot.js 共用
const { ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { safeResolveMarkdown } = require('./guard');

const MD_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd']);

function lastDir(app) {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'lastdir.json'), 'utf8')).dir; }
  catch { return app.getPath('documents'); }
}
function saveLastDir(app, p) {
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'lastdir.json'), JSON.stringify({ dir: path.dirname(p) })); }
  catch { /* ignore */ }
}

function registerIpc(app, getWindow) {
  ipcMain.handle('mdv:read-file', async (_e, filePath) => {
    const canon = safeResolveMarkdown(filePath);
    if (!canon) return { ok: false, message: '仅支持打开本地 Markdown 文件' };
    const buf = fs.readFileSync(canon);
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const stat = fs.statSync(canon);
    return { ok: true, text, mtime: stat.mtimeMs, size: stat.size };
  });

  ipcMain.handle('mdv:open-dialog', async () => {
    const win = getWindow();
    const r = await dialog.showOpenDialog(win, {
      title: '打开 Markdown 文件',
      defaultPath: lastDir(app),
      filters: [
        { name: 'Markdown 文档', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const canon = safeResolveMarkdown(r.filePaths[0]);
    if (!canon) return null;
    saveLastDir(app, canon);
    return canon;
  });

  ipcMain.handle('mdv:show-in-folder', (_e, p) => {
    const canon = safeResolveMarkdown(p);
    if (canon) shell.showItemInFolder(canon);
  });
  ipcMain.handle('mdv:open-external', (_e, url) => {
    if (/^(https?:\/\/|ms-settings:)/i.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('mdv:open-path', (_e, p) => {
    if (typeof p === 'string' && !p.split(/[\\/]/).includes('..')) shell.openPath(p);
  });

  ipcMain.handle('mdv:list-dir', async (_e, dirPath) => {
    try {
      if (typeof dirPath !== 'string' || !path.win32.isAbsolute(dirPath) ||
          dirPath.split(/[\\/]/).includes('..')) {
        return { ok: false, message: '非法目录' };
      }
      const dir = fs.realpathSync(dirPath);
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const dirs = [], mds = [];
      for (const en of entries) {
        if (en.name.startsWith('.')) continue;
        const full = path.join(dir, en.name);
        if (en.isDirectory()) dirs.push({ name: en.name, dir: true, path: full });
        else if (MD_EXTS.has(path.extname(en.name).toLowerCase())) mds.push({ name: en.name, dir: false, path: full });
      }
      dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      mds.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      return { ok: true, dirs, mds };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  });

  ipcMain.on('mdv:zoom', (_e, cmd) => {
    const win = getWindow();
    if (win) win.webContents.send('mdv:zoom', cmd);
  });

  // 主题切换：同步原生标题栏配色与系统主题
  ipcMain.on('mdv:theme', (_e, theme) => {
    const light = theme === 'light';
    nativeTheme.themeSource = light ? 'light' : 'dark';
    const win = getWindow();
    if (win && typeof win.setTitleBarOverlay === 'function') {
      try {
        win.setTitleBarOverlay(light
          ? { color: '#f3f3f3', symbolColor: '#3b3b3b' }
          : { color: '#17191a', symbolColor: '#cccccc' });
      } catch { /* 窗口不支持 overlay 时忽略 */ }
    }
  });
}

module.exports = { registerIpc };
