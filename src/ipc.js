'use strict';
// IPC 处理器：main.js 与 tools/shot.js 共用
const { ipcMain, dialog, shell, nativeTheme, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { safeResolveText, safeResolveDir } = require('./guard');

/** 每个窗口一个文件监听器，窗口关闭时清理 */
const watchers = new Map(); // webContents.id -> { watcher, dir, base, file, timer }

function winOf(e) {
  return BrowserWindow.fromWebContents(e.sender);
}

function prefFile(app, name) {
  return path.join(app.getPath('userData'), name);
}

async function readJson(file, dft) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return dft; }
}
async function writeJson(file, data) {
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(data), 'utf8');
  } catch { /* 存储失败不影响主流程 */ }
}

/** 版本号单一来源：package.json；读不到才退回 app.getVersion() */
function readPkgVersion(app) {
  try { return require('../package.json').version; }
  catch { return app.getVersion(); }
}

function lastDir(app) {
  const p = prefFile(app, 'lastdir.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).dir; } catch { return app.getPath('documents'); }
}
function saveLastDir(app, p) {
  try { fs.writeFileSync(prefFile(app, 'lastdir.json'), JSON.stringify({ dir: path.dirname(p) })); } catch { /* ignore */ }
}

function stopWatch(id) {
  const w = watchers.get(id);
  if (!w) return;
  clearTimeout(w.timer);
  try { w.watcher && w.watcher.close(); } catch { /* ignore */ }
  watchers.delete(id);
}

function startWatch(win, file) {
  const id = win.webContents.id;
  stopWatch(id);

  const rec = { watcher: null, dir: path.dirname(file), base: path.basename(file).toLowerCase(), file, timer: null };
  try {
    rec.watcher = fs.watch(rec.dir, { persistent: false }, (_event, filename) => {
      // filename 可能为 null（Windows 偶发），此时也走一次 stat，宁多勿漏
      if (filename && filename.toLowerCase() !== rec.base) return;
      clearTimeout(rec.timer);
      rec.timer = setTimeout(async () => {
        let stat = null;
        try { stat = await fsp.stat(file); } catch { /* 文件已删除 */ }
        if (win.isDestroyed()) return;
        win.webContents.send('mdv:file-changed', {
          path: file,
          exists: !!(stat && stat.isFile()),
          mtime: stat ? stat.mtimeMs : 0,
          size: stat ? stat.size : 0
        });
      }, 120);
    });
  } catch { /* 目录不可监视：静默降级，渲染进程仍可手动刷新 */ }

  watchers.set(id, rec);
}

function applyThemeTo(win, theme) {
  nativeTheme.themeSource = theme === 'system' ? 'system' : (theme === 'light' ? 'light' : 'dark');
  if (!win || win.isDestroyed() || typeof win.setTitleBarOverlay !== 'function') return;
  const dark = theme === 'system' ? nativeTheme.shouldUseDarkColors : theme !== 'light';
  try {
    win.setTitleBarOverlay(dark
      ? { color: '#17191a', symbolColor: '#cccccc' }
      : { color: '#f3f3f3', symbolColor: '#3b3b3b' });
  } catch { /* 窗口不支持 overlay 时忽略 */ }
}

function registerIpc(app, createWindow) {
  /* ---------------- 文件读取 ---------------- */
  ipcMain.handle('mdv:read-file', async (_e, filePath) => {
    const canon = safeResolveText(filePath);
    if (!canon) return { ok: false, code: 'invalid', message: '仅支持打开本地 Markdown 文本文件' };
    try {
      const [buf, stat] = await Promise.all([fsp.readFile(canon), fsp.stat(canon)]);
      let text = buf.toString('utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      return { ok: true, path: canon, text, mtime: stat.mtimeMs, size: stat.size, name: path.basename(canon) };
    } catch (err) {
      return { ok: false, code: 'io', message: `读取失败：${err.code || err.message}` };
    }
  });

  ipcMain.handle('mdv:stat-file', async (_e, filePath) => {
    const canon = safeResolveText(filePath);
    if (!canon) return { ok: false, exists: false };
    try {
      const st = await fsp.stat(canon);
      return { ok: true, exists: st.isFile(), mtime: st.mtimeMs, size: st.size };
    } catch {
      return { ok: true, exists: false };
    }
  });

  /* ---------------- 对话框 ---------------- */
  ipcMain.handle('mdv:open-dialog', async (e) => {
    const win = winOf(e);
    const r = await dialog.showOpenDialog(win, {
      title: '打开文档',
      defaultPath: lastDir(app),
      filters: [
        { name: 'Markdown / 文本', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt'] },
        { name: '仅 Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }
      ],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const canon = safeResolveText(r.filePaths[0]);
    if (!canon) return null;
    saveLastDir(app, canon);
    return canon;
  });

  ipcMain.handle('mdv:open-folder', async (e) => {
    const win = winOf(e);
    const r = await dialog.showOpenDialog(win, {
      title: '打开文件夹',
      defaultPath: lastDir(app),
      properties: ['openDirectory']
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const canon = safeResolveDir(r.filePaths[0]);
    if (!canon) return null;
    saveLastDir(app, path.join(canon, 'x'));
    return canon;
  });

  /* ---------------- 目录 ---------------- */
  ipcMain.handle('mdv:list-dir', async (_e, dirPath) => {
    const dir = safeResolveDir(dirPath);
    if (!dir) return { ok: false, message: '非法目录' };
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const dirs = [], mds = [];
      const { MD_EXTS } = require('./exts');
      for (const en of entries) {
        if (en.name.startsWith('.') || en.name === 'node_modules') continue;
        const full = path.join(dir, en.name);
        if (en.isDirectory()) dirs.push({ name: en.name, dir: true, path: full });
        else if (MD_EXTS.has(path.extname(en.name).toLowerCase())) mds.push({ name: en.name, dir: false, path: full });
      }
      const byName = (a, b) => a.name.localeCompare(b.name, 'zh');
      dirs.sort(byName);
      mds.sort(byName);
      const parent = path.dirname(dir);
      return { ok: true, dir, parent: parent === dir ? null : parent, dirs, mds };
    } catch (err) {
      return { ok: false, message: String(err && err.message || err) };
    }
  });

  /* ---------------- 系统集成 ---------------- */
  ipcMain.handle('mdv:show-in-folder', (_e, p) => {
    const canon = safeResolveText(p);
    if (canon) shell.showItemInFolder(canon);
  });

  ipcMain.handle('mdv:open-external', (_e, url) => {
    if (/^(https?:\/\/)/i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('mdv:open-path', (_e, p) => {
    if (typeof p !== 'string' || !p) return;
    if (p.split(/[\\/]/).includes('..')) return;
    shell.openPath(p);
  });

  ipcMain.handle('mdv:new-window', (_e, p) => {
    const canon = p ? safeResolveText(p) : null;
    if (typeof createWindow === 'function') createWindow(canon);
  });

  /* ---------------- 文件监听 ---------------- */
  ipcMain.handle('mdv:watch-file', (e, p) => {
    const win = winOf(e);
    if (!win) return false;
    const canon = safeResolveText(p);
    if (!canon) return false;
    startWatch(win, canon);
    return true;
  });

  ipcMain.handle('mdv:unwatch-file', (e) => {
    stopWatch(e.sender.id);
    return true;
  });

  /* ---------------- 保存 ---------------- */
  /**
   * 原子保存：先写同目录临时文件再 rename，避免写一半断电把原文件弄坏。
   * 保留原文件的 BOM 与换行风格，否则 git 上会出现"整篇都改了"的假差异。
   * expectedMtime 用于冲突检测；传 null 表示强制覆盖。
   */
  ipcMain.handle('mdv:save-file', async (_e, filePath, text, expectedMtime) => {
    const canon = safeResolveText(filePath);
    if (!canon) return { ok: false, code: 'invalid', message: '只能保存到已打开的本地 Markdown 文件' };
    if (typeof text !== 'string') return { ok: false, code: 'invalid', message: '内容无效' };

    let tmp = null;
    try {
      const st = await fsp.stat(canon);
      if (!st.isFile()) return { ok: false, code: 'io', message: '目标不是文件' };

      if (typeof expectedMtime === 'number' && expectedMtime > 0 && Math.abs(st.mtimeMs - expectedMtime) > 1) {
        return { ok: false, code: 'conflict', mtime: st.mtimeMs, message: '文件已被其他程序修改' };
      }

      const old = await fsp.readFile(canon);
      const hasBOM = old.length >= 3 && old[0] === 0xEF && old[1] === 0xBB && old[2] === 0xBF;
      const head = old.subarray(0, Math.min(old.length, 8192)).toString('utf8');
      const crlf = head.includes('\r\n');

      let body = text;
      if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
      body = body.replace(/\r\n/g, '\n');
      if (crlf) body = body.replace(/\n/g, '\r\n');

      const data = Buffer.from((hasBOM ? '\uFEFF' : '') + body, 'utf8');
      tmp = canon + '.mdv-save-' + process.pid + '-' + Date.now();
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, canon);
      tmp = null;

      const after = await fsp.stat(canon);
      return { ok: true, path: canon, mtime: after.mtimeMs, size: after.size, crlf, bom: hasBOM };
    } catch (err) {
      if (tmp) { try { await fsp.unlink(tmp); } catch { /* ignore */ } }
      return { ok: false, code: 'io', message: String((err && err.code) || (err && err.message) || err) };
    }
  });

  /* ---------------- 导出 / 打印 ---------------- */
  ipcMain.handle('mdv:export-pdf', async (e, suggestedName) => {
    const win = winOf(e);
    if (!win) return { ok: false };
    const base = String(suggestedName || 'document').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.(md|markdown|mdown|mkd|mdx|txt)$/i, '');
    const r = await dialog.showSaveDialog(win, {
      title: '导出 PDF',
      defaultPath: path.join(app.getPath('documents'), `${base}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const data = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
      });
      await fsp.writeFile(r.filePath, data);
      return { ok: true, path: r.filePath };
    } catch (err) {
      return { ok: false, message: String(err && err.message || err) };
    }
  });

  ipcMain.handle('mdv:print', async (e) => {
    const win = winOf(e);
    if (!win) return { ok: false };
    return new Promise((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => {
        resolve({ ok, reason });
      });
    });
  });

  /* ---------------- 应用信息 / 主题 ---------------- */
  ipcMain.handle('mdv:app-info', () => ({
    name: app.getName(),
    // 以 package.json 为唯一来源：开发态 app.getVersion() 可能回落到 Electron 版本
    version: readPkgVersion(app),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }));

  ipcMain.on('mdv:persist-theme', async (e, theme) => {
    const t = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'dark';
    await writeJson(prefFile(app, 'theme.json'), { theme: t });
    const win = winOf(e);
    applyThemeTo(win, t);
  });
}

module.exports = { registerIpc, stopWatch, applyThemeTo, readJson, prefFile, watchers };
