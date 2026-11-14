'use strict';
/**
 * 语法自检：对 src 与 tools 下所有 .js 跑 `node --check`。
 * 不引入 ESLint（避免额外依赖），但能挡住「改完文件语法错」这类低级事故。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'vendor', 'dist', '.git', '_analysis']);

function walk(dir, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(name.name)) continue;
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walk(full, out);
    else if (name.name.endsWith('.js')) out.push(full);
  }
}

const files = [];
walk(path.join(ROOT, 'src'), files);
walk(path.join(ROOT, 'tools'), files);

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error('语法错误：' + path.relative(ROOT, f));
    console.error((r.stderr || '').split('\n').slice(0, 5).join('\n'));
  }
}

console.log(`检查 ${files.length} 个文件，${bad ? bad + ' 个有语法错误' : '全部通过'}`);
process.exit(bad ? 1 : 0);
