'use strict';
/**
 * Windows 路径归一化（纯字符串运算，不碰文件系统）。
 * 单一来源：主进程守卫、渲染进程链接解析、命令行测试共用同一套规则，
 * 避免「图片能显示、链接点不动」这类前后端不一致。
 */

function normalizeWinPath(input) {
  let p = String(input == null ? '' : input).replace(/\//g, '\\');
  if (!p) return '';

  let stem = '';
  const drive = /^([a-zA-Z]:)/.exec(p);
  if (drive) {
    stem = drive[1];
    p = p.slice(stem.length);
  } else if (p.startsWith('\\\\')) {
    const segs = p.slice(2).split('\\');
    const host = segs.shift() || '';
    const share = segs.shift() || '';
    stem = '\\\\' + host + (share ? '\\' + share : '');
    p = segs.join('\\');
  }

  const out = [];
  for (const seg of p.split('\\')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  const joined = out.join('\\');

  if (!stem) return joined;
  if (stem.startsWith('\\\\')) return stem + (joined ? '\\' + joined : '');
  return stem + '\\' + joined;
}

const isAbs = (p) => /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);

/** 相对路径 → 绝对路径：`../x.md` 在这里被消解，不再触发路径守卫的拒绝 */
function joinAndNormalize(dir, rel) {
  const r = String(rel == null ? '' : rel);
  if (isAbs(r)) return normalizeWinPath(r);
  return normalizeWinPath(String(dir || '').replace(/[\\/]+$/, '') + '\\' + r);
}

module.exports = { normalizeWinPath, joinAndNormalize, isAbs };
