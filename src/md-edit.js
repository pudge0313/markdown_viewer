'use strict';
/**
 * Markdown 文本编辑变换 —— 纯函数，无 DOM 依赖，可被 Node 直接单测。
 *
 * 每个变换函数返回：
 *   {
 *     text,            变换后的全文（便于断言与快照）
 *     from, to,        原文中需要被替换的区间 [from, to)
 *     insert,          替换内容
 *     selStart,selEnd  变换后的选区（相对 text）
 *   }
 * 渲染进程只替换 [from, to) 这一段，因此撤销栈不会被整篇重写冲掉。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MDVEdit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const NL = '\n';

  /* ---------------- 基础定位 ---------------- */

  function lineStartOf(text, pos) {
    const p = Math.max(0, Math.min(pos, text.length));
    const i = text.lastIndexOf(NL, Math.max(0, p - 1));
    return i === -1 ? 0 : i + 1;
  }

  function lineEndOf(text, pos) {
    const p = Math.max(0, Math.min(pos, text.length));
    const i = text.indexOf(NL, p);
    return i === -1 ? text.length : i;
  }

  /** 选区覆盖到的整行范围；选区正好停在行首时不算下一行 */
  function selectedLineRange(text, start, end) {
    let e = end;
    if (e > start && text[e - 1] === NL) e -= 1;
    return [lineStartOf(text, start), lineEndOf(text, e)];
  }

  function result(text, from, to, insert, selStart, selEnd) {
    const out = text.slice(0, from) + insert + text.slice(to);
    return {
      text: out,
      from,
      to,
      insert,
      selStart: selStart == null ? from + insert.length : selStart,
      selEnd: selEnd == null ? from + insert.length : selEnd
    };
  }

  /* ---------------- 行内包裹 ---------------- */

  /**
   * 用成对标记包裹选区；已包裹则取消。
   * 无选区时插入标记并把光标放在中间（便于直接输入）。
   */
  function wrapInline(text, start, end, before, after, placeholder) {
    const a = before.length;
    const b = after.length;
    // 前后标记之外不能再连着同种字符，否则在 **粗体** 里选文字按斜体会把粗体拆掉
    const leftFree = start >= a && text[start - a - 1] !== before[a - 1];
    const rightFree = text[end + b] !== after[0];
    const already = start >= a
      && text.slice(start - a, start) === before
      && text.slice(end, end + b) === after
      && leftFree
      && rightFree;

    if (already) {
      const inner = text.slice(start, end);
      return result(text, start - a, end + b, inner, start - a, start - a + inner.length);
    }

    const inner = start === end ? String(placeholder || '') : text.slice(start, end);
    const insert = before + inner + after;
    return result(text, start, end, insert, start + a, start + a + inner.length);
  }

  // 无选区时插入空标记并把光标放中间（与 VS Code / Typora 一致），不预填占位文字
  const bold = (t, s, e) => wrapInline(t, s, e, '**', '**', '');
  const italic = (t, s, e) => wrapInline(t, s, e, '*', '*', '');
  const strike = (t, s, e) => wrapInline(t, s, e, '~~', '~~', '');
  const codeInline = (t, s, e) => wrapInline(t, s, e, '`', '`', '');

  function link(text, start, end, url) {
    const label = start === end ? '链接文字' : text.slice(start, end);
    const href = url || 'https://';
    const insert = `[${label}](${href})`;
    return result(text, start, end, insert, start + 1, start + 1 + label.length);
  }

  function image(text, start, end, src) {
    const alt = start === end ? '图片描述' : text.slice(start, end);
    const path = src || '图片路径';
    const insert = `![${alt}](${path})`;
    return result(text, start, end, insert, start + 2, start + 2 + alt.length);
  }

  /* ---------------- 行级变换 ---------------- */

  const HEADING_RE = /^\s{0,3}#{1,6}\s+/;
  const LIST_RE = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+|>\s+)/;

  /** 设置标题级别；选中行本来就全是该级别时取消 */
  function heading(text, start, end, level) {
    const [from, to] = selectedLineRange(text, start, end);
    const lines = text.slice(from, to).split(NL);
    const marks = '#'.repeat(level) + ' ';
    const all = lines.filter((l) => l.trim()).every((l) => l.startsWith(marks)) && lines.some((l) => l.trim());
    const out = lines.map((l) => {
      const bare = l.replace(HEADING_RE, '');
      return all ? bare : marks + bare;
    }).join(NL);
    return result(text, from, to, out, from + out.length, from + out.length);
  }

  function stripListMarker(line) {
    return line.replace(LIST_RE, '$1');
  }

  /**
   * 列表 / 引用 / 任务列表切换。
   * prefix: '- ' | '> ' | '- [ ] '；ordered=true 时按 1. 2. 3. 递增。
   * 全部行已是该样式 → 取消；否则统一改成该样式（保留缩进）。
   */
  function toggleLinePrefix(text, start, end, prefix, opts) {
    const ordered = !!(opts && opts.ordered);
    const [from, to] = selectedLineRange(text, start, end);
    const lines = text.slice(from, to).split(NL);
    const nonEmpty = lines.filter((l) => l.trim());

    const matches = (l) => (ordered ? /^\s*\d+\.\s+/.test(l) : l.replace(/^\s*/, '').startsWith(prefix.trim() + ' '));
    const all = nonEmpty.length > 0 && nonEmpty.every(matches);

    let n = 1;
    const out = lines.map((l) => {
      if (!l.trim()) return l;
      const indent = (l.match(/^[ \t]*/) || [''])[0];
      const bare = stripListMarker(l).slice(indent.length);
      if (all) return indent + bare;
      if (ordered) return indent + (n++) + '. ' + bare;
      return indent + prefix + bare;
    }).join(NL);

    return result(text, from, to, out, from, from + out.length);
  }

  function indent(text, start, end, unit) {
    const u = unit == null ? '  ' : unit;
    const [from, to] = selectedLineRange(text, start, end);
    const lines = text.slice(from, to).split(NL);
    const out = lines.map((l) => (l.length ? u + l : l)).join(NL);
    return result(text, from, to, out, from, from + out.length);
  }

  function outdent(text, start, end, unit) {
    const u = unit == null ? '  ' : unit;
    const [from, to] = selectedLineRange(text, start, end);
    const lines = text.slice(from, to).split(NL);
    const out = lines.map((l) => {
      if (l.startsWith(u)) return l.slice(u.length);
      if (l.startsWith('\t')) return l.slice(1);
      const m = l.match(/^ {1,2}/);
      return m ? l.slice(m[0].length) : l;
    }).join(NL);
    return result(text, from, to, out, from, from + out.length);
  }

  /* ---------------- 块级插入 ---------------- */

  /**
   * 插入独立块，并保证与上下文之间有空行。
   * 无选区时插到当前行之前（不破坏这一行）；有选区时替换选中的整行。
   */
  function insertBlock(text, start, end, block, caretOffset) {
    const isCaret = start === end;
    const [lineFrom, lineTo] = selectedLineRange(text, start, end);
    const from = lineFrom;
    const to = isCaret ? lineFrom : lineTo;

    let pre = '';
    if (from > 0) pre = (from >= 2 && text[from - 2] === NL) ? '' : NL;

    let post;
    if (isCaret) {
      post = text[from] === NL ? NL : NL + NL;
    } else if (to >= text.length) {
      post = NL;
    } else {
      post = text[to + 1] === NL ? '' : NL;
    }

    const insert = pre + block + post;
    const caret = from + pre.length + (caretOffset == null ? block.length : caretOffset);
    return result(text, from, to, insert, caret, caret);
  }

  const FENCE = '```';

  function codeBlock(text, start, end, lang) {
    const tag = lang || '';
    if (start !== end) {
      // 有选区：就地包成围栏，避免吃掉同一行的其他内容
      const inner = text.slice(start, end);
      const block = FENCE + tag + NL + inner + NL + FENCE;
      return result(text, start, end, block, start + block.length, start + block.length);
    }
    const block = FENCE + tag + NL + NL + FENCE;
    const caret = (FENCE + tag + NL).length;
    return insertBlock(text, start, end, block, caret);
  }

  function mathBlock(text, start, end) {
    const block = '$$' + NL + NL + '$$';
    return insertBlock(text, start, end, block, 3);
  }

  function hr(text, start, end) {
    return insertBlock(text, start, end, '---', 3);
  }

  function table(text, start, end, cols, rows) {
    const c = Math.max(1, Math.min(12, cols || 3));
    const r = Math.max(1, Math.min(30, rows || 2));
    const head = '| ' + Array.from({ length: c }, (_, i) => `列 ${i + 1}`).join(' | ') + ' |';
    const sep = '| ' + Array.from({ length: c }, () => '---').join(' | ') + ' |';
    const body = Array.from({ length: r }, () => '| ' + Array.from({ length: c }, () => '   ').join(' | ') + ' |');
    const block = [head, sep, ...body].join(NL);
    // 光标放到第一行第一格内容处
    return insertBlock(text, start, end, block, 4); // '| ' + '列 1'.length/2 附近
  }

  /** 当前日期时间，形如 2026-11-14 18:20 */
  function stamp(date) {
    const d = date || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function insertText(text, start, end, snippet) {
    return result(text, start, end, snippet, start + snippet.length, start + snippet.length);
  }

  /* ---------------- 光标信息 ---------------- */

  function lineInfo(text, pos) {
    const before = text.slice(0, Math.max(0, Math.min(pos, text.length)));
    const line = before.split(NL).length;
    const col = before.length - (before.lastIndexOf(NL) + 1) + 1;
    return { line, col };
  }

  function countChars(text) {
    return String(text || '').replace(/\s/g, '').length;
  }

  return {
    lineStartOf,
    lineEndOf,
    selectedLineRange,
    wrapInline,
    bold,
    italic,
    strike,
    codeInline,
    link,
    image,
    heading,
    toggleLinePrefix,
    indent,
    outdent,
    insertBlock,
    codeBlock,
    mathBlock,
    hr,
    table,
    stamp,
    insertText,
    lineInfo,
    countChars
  };
});
