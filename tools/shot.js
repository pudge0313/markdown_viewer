'use strict';
require('./ensure-electron').ensureElectron();
// 渲染指定 .md 文件并截取窗口内容为 PNG，用于回归比对与肉眼验收。
// 用法: MDV_SHOT=<out.png> MDV_FILE=<a.md> [MDV_DSF=1.25] [MDV_W=1387] [MDV_H=917] [MDV_WAIT=1500] npm run shot
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { safeResolveText } = require('../src/guard');
const { registerIpc } = require('../src/ipc');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OUT = process.env.MDV_SHOT || path.join(__dirname, '..', '_analysis', 'render.png');
const FILE = process.env.MDV_FILE || '';
const DSF = parseFloat(process.env.MDV_DSF || '1.25');
const PW = parseInt(process.env.MDV_W || '1387', 10); // 目标物理宽
const PH = parseInt(process.env.MDV_H || '917', 10); // 目标物理高
const WAIT = parseInt(process.env.MDV_WAIT || '1600', 10);

const FILE_CANON = FILE ? safeResolveText(FILE) : null;
if (FILE && !FILE_CANON) {
  console.error('MDV_FILE 非法：仅支持真实存在的本地 Markdown 文本文件');
  app.exit(2);
}

app.commandLine.appendSwitch('force-device-scale-factor', String(DSF));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

app.whenReady().then(async () => {
  const dipW = Math.round(PW / DSF);
  const dipH = Math.round(PH / DSF);

  registerIpc(app, () => null);

  const win = new BrowserWindow({
    width: dipW,
    height: dipH,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#17191a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => errors.push(`did-fail-load ${code} ${desc}`));

  if (process.env.MDV_CLEAR === '1') {
    await win.webContents.session.clearStorageData({ storages: ['localstorage'] });
  }

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  // 隐藏窗口的合成器不重绘，滚动截图会一直是首屏——必须让窗口真的显示一次
  if (process.env.MDV_SHOW !== '0') { win.showInactive(); await new Promise((r) => setTimeout(r, 300)); }

  if (FILE_CANON) {
    try {
      const r = await win.webContents.executeJavaScript(
        `MDV.tabs.openPath(${JSON.stringify(FILE_CANON)}).then(() => 'ok')`
      );
      if (r !== 'ok') errors.push('openPath 返回 ' + r);
    } catch (err) {
      errors.push('RENDER_ERR ' + err);
    }
  }

  await new Promise((r) => setTimeout(r, WAIT));

  if (process.env.MDV_SCROLL) {
    await win.webContents.executeJavaScript(`document.querySelector('#content').scrollTop = ${parseInt(process.env.MDV_SCROLL, 10) || 0}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  if (process.env.MDV_ACTION) {
    try { await win.webContents.executeJavaScript(process.env.MDV_ACTION); } catch (e) { errors.push('ACTION ' + e); }
    await new Promise((r) => setTimeout(r, 450));
  }

  if (process.env.MDV_PRINT === '1') {
    // 用调试协议模拟打印媒体，肉眼验收 @media print 排版
    try {
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
      await sleep(400);
    } catch (e) { errors.push('PRINT_EMU ' + e.message); }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: dipW, height: dipH });
  fs.writeFileSync(OUT, img.toPNG());

  const diag = await win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.width)]; };
    const v = document.getElementById('view');
    return {
      dpr: window.devicePixelRatio,
      tabs: q('.tab'),
      headings: q('#view h1, #view h2, #view h3, #view h4'),
      outline: q('#outline-list .ol-item'),
      codeBoxes: q('.code-box'),
      copyBtns: q('.code-copy'),
      tables: q('.table-wrap'),
      katex: q('.katex'),
      mermaidSvg: q('.mermaid-block svg'),
      mermaidErr: q('.mermaid-error'),
      frontMatter: q('.front-matter'),
      images: q('#view img'),
      checkboxes: Array.from(document.querySelectorAll('#view input[type=checkbox]')).map(c => (c.checked?'x':' ')+(c.disabled?'d':'')),
      relativeLinks: Array.from(document.querySelectorAll('#view a[data-local]')).map(a => a.dataset.local),
      outlineFirst: (document.querySelector('#outline-list .ol-item') || {}).textContent || '',
      viewWidth: v ? Math.round(v.getBoundingClientRect().width) : 0,
      textLen: v ? v.innerText.length : 0,
      win: [innerWidth, innerHeight],
      scrollTop: document.querySelector('#content') ? Math.round(document.querySelector('#content').scrollTop) : -1,
      scrollMax: document.querySelector('#content') ? Math.round(document.querySelector('#content').scrollHeight - document.querySelector('#content').clientHeight) : -1,
      bar: rect('#titlebar'), tabs: rect('#tabs'), actions: rect('.tb-actions'), content: rect('#content'), sidebar: rect('#sidebar')
    };
  })()`);

  console.log('DIAG ' + JSON.stringify(diag));
  if (errors.length) console.log('ERRORS ' + JSON.stringify(errors.slice(0, 12)));
  app.exit(0);
});
