'use strict';
const { app, BrowserWindow, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { safeResolveText } = require('./guard');
const { registerIpc, stopWatch, applyThemeTo } = require('./ipc');

/** 打开中的窗口（多窗口 = 对照阅读） */
const windows = new Set();
let nextWindowFile = null;

app.setAppUserModelId('com.pudge0313.markdownviewer');

/* ---------------- 启动前读取偏好，避免首帧闪色 ---------------- */
function prefPath(name) {
  return path.join(app.getPath('userData'), name);
}
function readPrefSync(name, dft) {
  try { return { ...dft, ...JSON.parse(fs.readFileSync(prefPath(name), 'utf8')) }; }
  catch { return dft; }
}

const themePref = readPrefSync('theme.json', { theme: 'dark' });
const startTheme = ['dark', 'light', 'system'].includes(themePref.theme) ? themePref.theme : 'dark';

function isDarkStart() {
  if (startTheme === 'system') return nativeTheme.shouldUseDarkColors;
  return startTheme !== 'light';
}

/* ---------------- 单实例：新文件交给已有窗口 ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const target = pickWindow();
    const f = fileFromArgv(argv);
    if (target) {
      if (target.isMinimized()) target.restore();
      target.focus();
      if (f) target.webContents.send('mdv:open-file', f);
    } else if (f) {
      createWindow(f);
    }
  });
}

function pickWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  for (const w of windows) if (!w.isDestroyed()) return w;
  return null;
}

function fileFromArgv(argv) {
  for (let i = argv.length - 1; i >= 0; i--) {
    const a = argv[i];
    if (!a || a.startsWith('-')) continue;
    if (a === app.getAppPath()) continue;
    const p = safeResolveText(a);
    if (p) return p;
  }
  return null;
}

/* ---------------- 窗口 ---------------- */
function loadWindowState() {
  const base = { width: 1400, height: 920 };
  const saved = readPrefSync('window-state.json', base);
  return { width: saved.width || base.width, height: saved.height || base.height, x: saved.x, y: saved.y };
}
function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  try { fs.writeFileSync(prefPath('window-state.json'), JSON.stringify(b), 'utf8'); } catch { /* ignore */ }
}

function createWindow(file) {
  const state = loadWindowState();
  const dark = isDarkStart();
  nativeTheme.themeSource = startTheme === 'system' ? 'system' : (dark ? 'dark' : 'light');

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 720,
    minHeight: 460,
    show: false,
    backgroundColor: dark ? '#17191a' : '#f3f3f3',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark ? '#17191a' : '#f3f3f3',
      symbolColor: dark ? '#cccccc' : '#3b3b3b',
      height: 46
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  windows.add(win);
  const wcId = win.webContents.id;

  // 站内导航拦截：一切页面跳转都留在应用内处理，外链由渲染进程显式调用系统浏览器
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
  // 兜底：个别环境 ready-to-show 不触发
  const showTimer = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 2500);

  win.on('close', () => saveWindowState(win));
  win.on('closed', () => {
    clearTimeout(showTimer);
    stopWatch(wcId);
    windows.delete(win);
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 首帧加载完成后投递待打开文件（此时渲染进程已注册监听）
  if (file) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send('mdv:open-file', file);
    });
  }

  return win;
}

/* ---------------- 菜单 ---------------- */
function send(cmd) {
  const win = pickWindow();
  if (win) win.webContents.send('mdv:menu', cmd);
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: '打开文件夹…', accelerator: 'CmdOrCtrl+K', registerAccelerator: false, click: () => send('open-folder') },
        { type: 'separator' },
        { label: '在新窗口打开当前文件', click: () => send('new-window') },
        { label: '关闭当前标签', accelerator: 'CmdOrCtrl+W', registerAccelerator: false, click: () => send('close-tab') },
        { type: 'separator' },
        { label: '导出 PDF…', click: () => send('export-pdf') },
        { label: '打印…', accelerator: 'CmdOrCtrl+P', click: () => send('print') },
        { type: 'separator' },
        { label: '在资源管理器中显示', click: () => send('reveal') },
        { label: '设为默认 .md 打开程序…', click: () => send('default-app') },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '查找…', accelerator: 'CmdOrCtrl+F', registerAccelerator: false, click: () => send('find') },
        { label: '文件列表', accelerator: 'CmdOrCtrl+B', click: () => send('toggle-sidebar') },
        { label: '大纲', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('toggle-outline') },
        { type: 'separator' },
        { label: '上一个标签', accelerator: 'Ctrl+Tab', registerAccelerator: false, click: () => send('next-tab') },
        { label: '下一个标签', accelerator: 'Ctrl+Shift+Tab', registerAccelerator: false, click: () => send('prev-tab') },
        { label: '后退', accelerator: 'Alt+Left', registerAccelerator: false, click: () => send('nav-back') },
        { label: '前进', accelerator: 'Alt+Right', registerAccelerator: false, click: () => send('nav-forward') },
        { type: 'separator' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') },
        { type: 'separator' },
        { label: '阅读设置…', click: () => send('settings') },
        { label: '切换深浅色', accelerator: 'CmdOrCtrl+Shift+L', click: () => send('toggle-theme') },
        { label: '切换开发者工具', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '快捷键', accelerator: 'F1', registerAccelerator: false, click: () => send('keys') },
        { type: 'separator' },
        { label: '关于', click: () => send('about') }
      ]
    }
  ]);
}

/* ---------------- 生命周期 ---------------- */
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  const canon = safeResolveText(filePath);
  if (!canon) return;
  if (app.isReady()) {
    const win = pickWindow();
    if (win) win.webContents.send('mdv:open-file', canon);
    else createWindow(canon);
  } else {
    nextWindowFile = canon;
  }
});

app.whenReady().then(() => {
  registerIpc(app, createWindow);
  applyThemeTo(null, startTheme);
  Menu.setApplicationMenu(buildMenu());
  createWindow(nextWindowFile || fileFromArgv(process.argv));
  nextWindowFile = null;
});

app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (!windows.size) createWindow(); });
