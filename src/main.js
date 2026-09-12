'use strict';
const { app, BrowserWindow, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { safeResolveMarkdown, MD_EXTS } = require('./guard');
const { registerIpc } = require('./ipc');

let mainWindow = null;
let pendingFile = null; // file to open once window is ready

app.setAppUserModelId('com.pudge0313.markdownviewer');

// Keep only one instance; route new files into the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const f = fileFromArgv(argv);
      if (f) sendOpenFile(f);
    }
  });
}

function fileFromArgv(argv) {
  for (let i = argv.length - 1; i >= 0; i--) {
    const a = argv[i];
    if (!a || a.startsWith('-')) continue;
    if (a === app.getAppPath()) continue;
    const p = safeResolveMarkdown(a);
    if (p) return p;
  }
  return null;
}

function sendOpenFile(file) {
  if (mainWindow && mainWindow.webContents.isLoading() === false) {
    mainWindow.webContents.send('mdv:open-file', file);
  } else {
    pendingFile = file;
  }
}

function createWindow() {
  nativeTheme.themeSource = 'dark';
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 640,
    minHeight: 420,
    show: false,
    backgroundColor: '#17191a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#17191a',
      symbolColor: '#cccccc',
      height: 47
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  // Windows: files dropped / double-clicked while running
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://') && MD_EXTS.has(path.extname(url).toLowerCase())) {
      e.preventDefault();
      sendOpenFile(fileURLToPath2(url));
    } else if (/^https?:/.test(url)) {
      e.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    try { fs.appendFileSync(path.join(app.getPath('temp'), 'mdv-debug.log'), `ready-to-show\n`); } catch { /* ignore */ }
    mainWindow.show();
  });
  // 兜底：某些环境下 ready-to-show 可能不触发
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      try { fs.appendFileSync(path.join(app.getPath('temp'), 'mdv-debug.log'), `fallback-show\n`); } catch { /* ignore */ }
      mainWindow.show();
    }
  }, 2500);

  mainWindow.on('close', () => saveWindowState());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const opened = fileFromArgv(process.argv);
  if (opened) pendingFile = opened;
}

function fileURLToPath2(url) {
  try {
    return decodeURIComponent(url.replace(/^file:\/\/\//, '').replace(/\//g, '\\'));
  } catch { return url; }
}

// ---------- window state ----------
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}
function loadWindowState() {
  const base = { width: 1400, height: 920 };
  try { return { ...base, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) }; }
  catch { return base; }
}
function saveWindowState() {
  if (!mainWindow) return;
  const b = mainWindow.getBounds();
  try { fs.writeFileSync(stateFile(), JSON.stringify(b), 'utf8'); } catch { /* ignore */ }
}

// ---------- app events ----------
app.on('open-file', (e, filePath) => {           // macOS
  e.preventDefault();
  const canon = safeResolveMarkdown(filePath);
  if (canon) {
    if (app.isReady()) sendOpenFile(canon);
    else pendingFile = canon;
  }
});

app.whenReady().then(() => {
  registerIpc(app, () => mainWindow);
  createWindow();
  Menu.setApplicationMenu(buildMenu());
  // flush pending file after renderer is up (wait until the page finished loading)
  const t = setInterval(() => {
    if (pendingFile && mainWindow && !mainWindow.webContents.isLoading()) {
      mainWindow.webContents.send('mdv:open-file', pendingFile);
      pendingFile = null;
      clearInterval(t);
    }
  }, 200);
  setTimeout(() => clearInterval(t), 30000);
});

app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });

function buildMenu() {
  const tpl = [
    {
      label: '文件',
      submenu: [
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('mdv:menu', 'open') },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '文件列表', accelerator: 'CmdOrCtrl+B', click: () => mainWindow.webContents.send('mdv:menu', 'toggle-sidebar') },
        { type: 'separator' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', click: () => mainWindow.webContents.send('mdv:zoom', 'in') },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => mainWindow.webContents.send('mdv:zoom', 'out') },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.send('mdv:zoom', 'reset') },
        { type: 'separator' },
        { label: '刷新', accelerator: 'CmdOrCtrl+R', role: 'reload' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于', click: () => mainWindow.webContents.send('mdv:menu', 'about') }
      ]
    }
  ];
  return Menu.buildFromTemplate(tpl);
}
