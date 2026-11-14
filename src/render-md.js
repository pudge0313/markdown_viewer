'use strict';
/**
 * Markdown 渲染管线（纯函数，不依赖 Electron）。
 * 主进程 preload 与 tools/smoke.js 共用，便于命令行回归测试。
 *
 * 职责边界：
 *   - 这里只做「Markdown 文本 → HTML 字符串 + 元信息」
 *   - 不做 DOM 增强（代码块复制按钮、表格包裹、mermaid 实绘）——那些在渲染进程 view.js
 */
const { Marked } = require('marked');
const hljs = require('highlight.js');

let katex = null;
try { katex = require('katex'); } catch { katex = null; }

const MD_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd']);

/* 可选打开（只读）：比 MD_EXTS 宽，用于文件对话框 */
const TEXT_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt']);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}

/** 从 HTML 片段里取纯文本（标题 id 用） */
function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * GitHub 风格 slug：保留中日韩字符、字母数字，其余折叠为 -
 */
function slugify(text) {
  const base = stripTags(text)
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'section';
}

/** 生成不重复的 id（GitHub 规则：重复时追加 -1、-2…） */
function makeSlugger() {
  const used = new Map();
  return (text) => {
    const base = slugify(text);
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

const FRONT_MATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * 渲染 Markdown。
 * @param {string} src 原始文本
 * @param {object} opts
 *   highlight  {boolean} 是否语法高亮（超大文档可关，默认 true）
 *   math       {boolean} 是否渲染 $…$ / $$…$$
 *   breaks     {boolean} 单个换行是否 <br>（默认 true，与旧版行为一致）
 * @returns {{html:string, headings:Array, hasMermaid:boolean, hasMath:boolean, frontMatter:object|null}}
 */
function renderMarkdown(src, opts = {}) {
  const {
    highlight = true,
    math = true,
    breaks = true
  } = opts;

  let text = String(src == null ? '' : src);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  text = text.replace(/\r\n?/g, '\n');

  /* ---------- front matter ---------- */
  let frontMatter = null;
  const fm = FRONT_MATTER_RE.exec(text);
  if (fm) {
    frontMatter = { raw: fm[1], lines: fm[1].split('\n').length };
    text = text.slice(fm[0].length);
  }

  const headings = [];
  const nextSlug = makeSlugger();
  let hasMermaid = false;
  let hasMath = false;

  const md = new Marked();
  md.use({
    gfm: true,
    breaks,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = nextSlug(stripTags(inner));
        headings.push({ depth, text: stripTags(inner).trim(), id });
        return `<h${depth} id="${escapeAttr(id)}">${inner}</h${depth}>\n`;
      },
      code({ text: code, lang }) {
        const name = String(lang || '').trim().split(/\s+/)[0].toLowerCase();

        // mermaid：只占位，交给渲染进程按需实绘（避免首次打开就加载 3MB 运行时）
        if (name === 'mermaid') {
          hasMermaid = true;
          const b64 = Buffer.from(code, 'utf8').toString('base64');
          return `<div class="mermaid-block" data-graph="${b64}"><div class="mermaid-status">图表渲染中…</div></div>`;
        }

        let out;
        let cls = 'hljs';
        if (highlight && name && hljs.getLanguage(name)) {
          try {
            out = hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
            cls += ' language-' + name;
          } catch {
            out = escapeHtml(code);
          }
        } else {
          out = escapeHtml(code);
          if (name) cls += ' language-' + name;
        }
        return `<pre><code class="${cls}">${out}\n</code></pre>`;
      }
    },
    extensions: math && katex ? [mathBlock(), mathInline()] : []
  });

  const html = md.parse(text);

  return {
    html,
    headings,
    hasMermaid,
    hasMath,
    frontMatter
  };
}

/* ---------------- 数学公式扩展 ---------------- */

function renderMath(tex, display) {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: false,
      output: 'html',
      trust: false
    });
  } catch (err) {
    return `<code class="math-error" title="${escapeAttr(String(err && err.message))}">${escapeHtml(tex)}</code>`;
  }
}

function mathBlock() {
  return {
    name: 'mathBlock',
    level: 'block',
    start(src) {
      const i = src.indexOf('$$');
      return i < 0 ? undefined : i;
    },
    tokenizer(src) {
      const m = /^\$\$[ \t]*\n?([\s\S]+?)\n?\$\$[ \t]*(?:\n+|$)/.exec(src);
      if (!m) return undefined;
      return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
    },
    renderer(token) {
      return `<div class="math-block">${renderMath(token.text, true)}</div>\n`;
    }
  };
}

function mathInline() {
  return {
    name: 'mathInline',
    level: 'inline',
    start(src) {
      const i = src.indexOf('$');
      return i < 0 ? undefined : i;
    },
    tokenizer(src) {
      // $...$：首尾非空白、不跨行、避开 $$ 与 $10 这类金额
      const m = /^\$(?!\$)(?=\S)((?:\\.|[^\\$\n])+?)(?<=\S)\$(?!\d)/.exec(src);
      if (!m) return undefined;
      return { type: 'mathInline', raw: m[0], text: m[1] };
    },
    renderer(token) {
      return renderMath(token.text, false);
    }
  };
}

module.exports = { renderMarkdown, MD_EXTS, TEXT_EXTS, slugify };
