'use strict';
/**
 * 打包产物自检：启动 dist/win-unpacked 里的真实 exe，通过 CDP 读取页面渲染结果。
 * 用于验证「依赖/前端产物是否真的打进 asar」——这类问题只有跑打包后的程序才会暴露。
 *
 * 用法：node tools/packaged-check.js
 *      node tools/packaged-check.js --exe "dist/win-unpacked/xxx.exe" --file "<测试.md>"
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 9223 + (Number(process.env.MDV_CDP_OFFSET) || 0);

function arg(name, dft) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dft;
}

const EXE = arg('exe', path.join(ROOT, 'dist', 'win-unpacked', 'Markdown 查看器.exe'));
const FILE = arg('file', path.join(ROOT, '_analysis', 'demo', 'packaged-check.md'));

if (!fs.existsSync(EXE)) {
  console.error('找不到打包产物：' + EXE + '\n请先执行 npm run dist');
  process.exit(2);
}
if (!fs.existsSync(FILE)) {
  console.error('找不到测试文档：' + FILE);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function evaluate(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error('CDP 超时')); }, 15000);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true }
      }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else if (msg.result && msg.result.exceptionDetails) {
        const d = msg.result.exceptionDetails;
        reject(new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'CDP 执行异常'));
      } else resolve(msg.result.result.value);
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error('CDP 连接失败 ' + (e && e.message || ''))); };
  });
}

(async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;

  // 每次用全新的配置目录：否则会恢复上次会话的标签，断言就不稳定了
  const profile = path.join(ROOT, '_analysis', 'pkgcheck-profile');
  fs.rmSync(profile, { recursive: true, force: true });

  const child = spawn(EXE, [FILE, `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore', detached: false });
  const kill = () => {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  };

  let wsUrl = null;
  for (let i = 0; i < 40 && !wsUrl; i++) {
    await sleep(400);
    try {
      const list = await targets();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
  }
  if (!wsUrl) { kill(); console.error('无法连接调试端口，打包产物可能启动失败'); process.exit(1); }

  const EXPR = `(() => {
    const v = document.getElementById('view');
    if (!v) return { booting: true };
    return {
      title: document.title,
      tabs: document.querySelectorAll('.tab').length,
      headings: document.querySelectorAll('#view h1, #view h2, #view h3').length,
      tableWrap: document.querySelectorAll('.table-wrap').length,
      codeBox: document.querySelectorAll('.code-box').length,
      katex: document.querySelectorAll('.katex').length,
      mermaidSvg: document.querySelectorAll('.mermaid-block svg').length,
      mermaidErr: document.querySelectorAll('.mermaid-error').length,
      purified: typeof window.DOMPurify !== 'undefined',
      editor: !!document.querySelector('#editor-input'),
      modeBtns: document.querySelectorAll('.mode-btn').length,
      saveBtn: !!document.querySelector('#btn-save'),
      editApi: typeof window.MDVEdit === 'object' && typeof window.MDVEdit.bold === 'function',
      textLen: (v.innerText || '').length
    };
  })()`;

  let snap = null;
  for (let i = 0; i < 25; i++) {
    try {
      const got = await evaluate(wsUrl, EXPR);
      if (got && !got.booting) snap = got;
      if (snap && snap.mermaidSvg > 0 && snap.katex > 0) break;
    } catch { /* 页面还在加载，重试 */ }
    await sleep(400);
  }
  if (!snap) { kill(); console.error('页面未完成渲染，无法自检'); process.exit(1); }

  kill();

  const checks = [
    ['窗口标题包含文件名', /packaged-check\.md/.test(snap.title || ''), snap.title],
    ['标签页已创建', snap.tabs === 1, snap.tabs],
    ['正文有内容', snap.textLen > 50, snap.textLen],
    ['标题已渲染', snap.headings >= 1, snap.headings],
    ['表格容器已包裹', snap.tableWrap >= 1, snap.tableWrap],
    ['代码块增强生效（依赖 highlight.js）', snap.codeBox >= 1, snap.codeBox],
    ['KaTeX 公式渲染（依赖 katex）', snap.katex >= 2, snap.katex],
    ['mermaid 图表渲染（依赖 vendor 产物）', snap.mermaidSvg >= 1, snap.mermaidSvg],
    ['mermaid 无渲染错误', snap.mermaidErr === 0, snap.mermaidErr],
    ['DOMPurify 已加载（依赖 vendor 产物）', snap.purified === true, snap.purified],
    ['编辑区已渲染', snap.editor === true, snap.editor],
    ['编辑 / 分栏 / 预览三档存在', snap.modeBtns === 3, snap.modeBtns],
    ['保存按钮存在', snap.saveBtn === true, snap.saveBtn],
    ['编辑模块已注入（MDVEdit）', snap.editApi === true, snap.editApi]
  ];

  let failed = 0;
  console.log('\n[打包产物自检] ' + path.basename(EXE));
  for (const [name, ok, extra] of checks) {
    if (!ok) failed++;
    console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  → ' + JSON.stringify(extra)));
  }
  console.log(`\n通过 ${checks.length - failed} 项，失败 ${failed} 项`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('自检异常：', err);
  process.exit(2);
});
