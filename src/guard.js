'use strict';
// 用户提供的路径校验：只放行绝对路径、无穿越段、白名单扩展名、
// 真实存在且位于其盘符根之下的常规文件/目录。
//
// 纵深防御说明：渲染进程在跳转相对链接前已把 `../` 归一化（js/util.js normalizePath），
// 这里仍然拒绝任何含 `..` 的路径——即使渲染进程被绕过，也拿不到目录外的文件。
const path = require('path');
const fs = require('fs');
const { MD_EXTS, isMd, isText } = require('./exts');

function baseCheck(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 1024 || raw.includes('\0')) return null;
  if (!path.win32.isAbsolute(raw)) return null;

  const norm = path.win32.normalize(raw);
  const segs = norm.split(/[\\/]/);
  if (segs.includes('..')) return null;

  let canon;
  try {
    canon = fs.realpathSync(norm); // canonical absolute path; throws if missing
  } catch {
    return null;
  }
  // 允许仅大小写不同（Windows 路径大小写不敏感），但拒绝软链接跳转到别处
  if (canon !== norm && canon.toUpperCase() !== norm.toUpperCase()) return null;

  const root = path.win32.parse(canon).root; // e.g. "C:\" or "\\srv\share"
  if (!root || !(canon === root || canon.startsWith(root))) return null;
  return canon;
}

function resolveFile(raw, predicate) {
  const canon = baseCheck(raw);
  if (!canon || !predicate(canon)) return null;
  try {
    if (!fs.statSync(canon).isFile()) return null;
  } catch {
    return null;
  }
  return canon;
}

/** 只允许 Markdown 家族（目录树、归档用途） */
function safeResolveMarkdown(raw) {
  return resolveFile(raw, isMd);
}

/** 允许 Markdown / mdx / txt（只读打开） */
function safeResolveText(raw) {
  return resolveFile(raw, isText);
}

/** 目录：打开文件夹作为工作区、目录树列举 */
function safeResolveDir(raw) {
  const canon = baseCheck(raw);
  if (!canon) return null;
  try {
    if (!fs.statSync(canon).isDirectory()) return null;
  } catch {
    return null;
  }
  return canon;
}

module.exports = { safeResolveMarkdown, safeResolveText, safeResolveDir, MD_EXTS };
