'use strict';
/**
 * 把 node_modules 里的第三方前端产物复制到 src/renderer/vendor。
 * 这些文件不进 git（见 .gitignore），由 npm 的 prestart / predist 钩子自动生成，
 * 保证「clone → npm install → npm start」即可运行。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'src', 'renderer', 'vendor');

function need(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`[vendor] 缺少 ${label}：${p}\n请先执行 npm install`);
    process.exit(1);
  }
}

function copyFile(from, to) {
  need(from, path.basename(from));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  const kb = (fs.statSync(to).size / 1024).toFixed(0);
  console.log(`[vendor] ${path.relative(ROOT, to)}  (${kb} KB)`);
}

function copyDir(from, to, filter) {
  need(from, path.basename(from));
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(from)) {
    if (filter && !filter(name)) continue;
    fs.copyFileSync(path.join(from, name), path.join(to, name));
    n++;
  }
  console.log(`[vendor] ${path.relative(ROOT, to)}/  (${n} files)`);
}

/* 只在 mermaid 版本变化时重拷 5MB 大文件 */
function copyIfChanged(from, to) {
  need(from, path.basename(from));
  try {
    if (fs.statSync(to).size === fs.statSync(from).size) return;
  } catch { /* 目标不存在 */ }
  copyFile(from, to);
}

fs.mkdirSync(OUT, { recursive: true });

copyFile(path.join(NM, 'dompurify', 'dist', 'purify.min.js'), path.join(OUT, 'purify.min.js'));
copyIfChanged(path.join(NM, 'mermaid', 'dist', 'mermaid.min.js'), path.join(OUT, 'mermaid.min.js'));

copyFile(path.join(NM, 'katex', 'dist', 'katex.min.css'), path.join(OUT, 'katex', 'katex.min.css'));
copyDir(
  path.join(NM, 'katex', 'dist', 'fonts'),
  path.join(OUT, 'katex', 'fonts'),
  (f) => f.endsWith('.woff2') || f.endsWith('.woff')
);

console.log('[vendor] 完成');
