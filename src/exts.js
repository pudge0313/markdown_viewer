'use strict';
/** 扩展名白名单：单一来源，避免主进程 / 渲染管线各写一份导致漂移 */
const path = require('path');

/* 目录树里列出、可跳转的 Markdown 家族 */
const MD_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd']);

/* 允许以只读方式打开的全部文本类型（对话框、拖放、命令行参数） */
const TEXT_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt']);

function extOf(p) {
  return path.win32.extname(String(p || '')).toLowerCase();
}
function isMd(p) { return MD_EXTS.has(extOf(p)); }
function isText(p) { return TEXT_EXTS.has(extOf(p)); }

module.exports = { MD_EXTS, TEXT_EXTS, extOf, isMd, isText };
