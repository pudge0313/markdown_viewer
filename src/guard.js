'use strict';
// 用户提供的 Markdown 路径校验：只放行绝对路径、无穿越段、白名单扩展名、
// 真实存在且位于其盘符根之下的常规文件。
const path = require('path');
const fs = require('fs');

const MD_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd']);

function safeResolveMarkdown(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 1024 || raw.includes('\0')) return null;
  if (!path.win32.isAbsolute(raw)) return null;

  const norm = path.win32.normalize(raw);
  const segs = norm.split(/[\\/]/);
  if (segs.includes('..') || segs.includes('.')) return null;
  if (!MD_EXTS.has(path.win32.extname(norm).toLowerCase())) return null;

  let canon;
  try {
    canon = fs.realpathSync(norm); // canonical absolute path; throws if missing
  } catch {
    return null;
  }
  if (canon !== norm && canon.toUpperCase() !== norm.toUpperCase()) return null;

  const root = path.win32.parse(canon).root; // e.g. "C:\" or "\\srv\share"
  if (!root || !(canon === root || canon.startsWith(root))) return null;

  try {
    if (!fs.statSync(canon).isFile()) return null;
  } catch {
    return null;
  }
  return canon;
}

module.exports = { safeResolveMarkdown, MD_EXTS };
