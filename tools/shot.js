'use strict';
// 渲染指定 .md 文件并截取窗口内容为 PNG，用于与参考截图做像素比对。
// 默认以 DSF=1.25 渲染（参考截图的生成环境）：窗口 DIP = 物理/1.25。
// 用法: MDV_SHOT=<out.png> MDV_FILE=<a.md> [MDV_DSF=1.25] [MDV_W=1387] [MDV_H=917] electron tools/shot.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { safeResolveMarkdown } = require('../src/guard');

const OUT = process.env.MDV_SHOT || path.join(__dirname, '..', '_analysis', 'render.png');
const FILE = process.env.MDV_FILE || '';
const DSF = parseFloat(process.env.MDV_DSF || '1.25');
const PW = parseInt(process.env.MDV_W || '1387', 10); // 目标物理宽
const PH = parseInt(process.env.MDV_H || '917', 10); // 目标物理高

// 入口点即校验：MDV_FILE 必须通过与主进程相同的路径守卫
const FILE_CANON = FILE ? safeResolveMarkdown(FILE) : null;
if (FILE && !FILE_CANON) {
  console.error('MDV_FILE 非法：仅支持真实存在的本地 Markdown 绝对路径');
  app.exit(2);
}

app.commandLine.appendSwitch('force-device-scale-factor', String(DSF));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

app.whenReady().then(async () => {
  const dipW = Math.round(PW / DSF);
  const dipH = Math.round(PH / DSF);

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
      spellcheck: false
    }
  });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  if (FILE_CANON) {
    // 主进程读取（已过 safeResolveMarkdown 校验），直接注入渲染进程，不经过 IPC
    const text = fs.readFileSync(FILE_CANON, 'utf8').replace(/^\uFEFF/, '');
    try {
      await win.webContents.executeJavaScript(
        `openFromText(${JSON.stringify(FILE_CANON)}, ${JSON.stringify(text)}, {watch: false})` +
        ` && 'opened ' + document.getElementById('view').innerText.length`
      );
      if (process.env.MDV_SCROLL) {
        await win.webContents.executeJavaScript(`document.querySelector('#content').scrollTop = ${parseInt(process.env.MDV_SCROLL, 10) || 0}`);
      }
    } catch (err) {
      console.error('RENDER_ERR ' + err);
    }
  }

  await new Promise(r => setTimeout(r, 700));

  const img = await win.webContents.capturePage({ x: 0, y: 0, width: dipW, height: dipH });
  fs.writeFileSync(OUT, img.toPNG());

  const diag = await win.webContents.executeJavaScript(`(() => {
    const v = document.getElementById('view');
    const r = v.getBoundingClientRect();
    const pick = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      view: pick(v), h1: pick(v.querySelector('h1')), quote: pick(v.querySelector('blockquote')),
      table: pick(v.querySelector('table')), dpr: window.devicePixelRatio
    };
  })()`);
  console.log(`DIAG out=${img.getSize().width}x${img.getSize().height} ` + JSON.stringify(diag));

  app.exit(0);
});
