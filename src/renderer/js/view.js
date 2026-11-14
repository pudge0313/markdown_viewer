'use strict';
/* 渲染结果 → DOM 增强层：清洗、链接解析、代码复制、表格包裹、mermaid、进度条 */
(function () {
  const MDV = window.MDV;
  const { $, $$, el, normalizeWinPath, joinAndNormalize, fileURL } = MDV;

  const view = $('#view');
  const content = $('#content');
  const progress = $('#progressbar i');

  /* ---------------- 清洗 ---------------- */
  const PURIFY_CFG = {
    FORBID_TAGS: ['style', 'link', 'base', 'form', 'iframe', 'object', 'embed', 'meta'],
    FORBID_ATTR: ['srcset'],
    ADD_ATTR: ['align', 'colspan', 'rowspan', 'disabled', 'checked', 'type'],
    ALLOW_DATA_ATTR: true
  };

  function sanitize(html) {
    if (!window.DOMPurify) return html;
    try { return window.DOMPurify.sanitize(html, PURIFY_CFG); }
    catch { return html; }
  }

  /* ---------------- 链接 / 图片解析 ---------------- */
  function mapLinks(root, currentPath) {
    const dir = MDV.dirname(currentPath);

    root.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (/^(https?:|data:|blob:|file:)/i.test(src)) return;
      img.src = fileURL(joinAndNormalize(dir, src));
      img.loading = 'lazy';
      img.classList.add('zoomable');
      if (!img.alt) img.alt = MDV.baseName(src);
    });

    root.querySelectorAll('a[href]').forEach((a) => {
      // marked 会对 URL 做百分号编码，中文文件名必须先解码，否则拼出来的路径打不开
      let href = (a.getAttribute('href') || '').trim();
      try { href = decodeURIComponent(href); } catch { /* 保留原样 */ }
      a.removeAttribute('target');
      a.removeAttribute('rel');
      if (!href) return;

      if (/^https?:/i.test(href)) { a.dataset.ext = href; return; }
      if (/^mailto:/i.test(href)) return;
      if (/^#/.test(href)) { a.dataset.anchor = decodeURIComponent(href.slice(1)); return; }
      if (/^file:/i.test(href)) {
        const p = decodeURIComponent(href.replace(/^file:\/\/\//, ''));
        a.dataset.local = normalizeWinPath(p);
        return;
      }
      // 关键修复：相对链接先归一化，再交给主进程校验（原来带 ../ 会被路径守卫拒绝）
      a.dataset.local = joinAndNormalize(dir, href.split('#')[0]);
      if (href.includes('#')) a.dataset.hash = href.split('#')[1];
    });
  }

  /* ---------------- 表格横向滚动 + 表头吸顶 ---------------- */
  function wrapTables(root) {
    root.querySelectorAll('table').forEach((table) => {
      if (table.parentElement && table.parentElement.classList.contains('table-wrap')) return;
      const wrap = el('div', 'table-wrap');
      table.replaceWith(wrap);
      wrap.appendChild(table);
    });
  }

  /* ---------------- 代码块复制 ---------------- */
  function enhanceCode(root) {
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.closest('.code-box') || pre.closest('.mermaid-block')) return;
      const code = pre.querySelector('code');
      const langMatch = code && /language-([\w+#-]+)/.exec(code.className);
      const lang = langMatch ? langMatch[1] : '';

      const box = el('div', 'code-box');
      pre.replaceWith(box);
      box.appendChild(pre);

      const bar = el('div', 'code-bar');
      if (lang) bar.appendChild(el('span', 'code-lang', lang));
      const btn = el('button', 'code-copy', '复制');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        const text = pre.innerText.replace(/\n$/, '');
        const ok = await copyText(text);
        btn.textContent = ok ? '已复制' : '复制失败';
        btn.classList.add('done');
        setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('done'); }, 1400);
      });
      bar.appendChild(btn);
      box.insertBefore(bar, pre);
    });
  }

  async function copyText(text) {
    // 桌面端优先用 Electron 剪贴板：file:// 下 navigator.clipboard 常常不可用
    if (window.mdv && typeof window.mdv.copyText === 'function') {
      try { if (window.mdv.copyText(text)) return true; } catch { /* 落回浏览器 API */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = el('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch { return false; }
    }
  }

  /* ---------------- mermaid 懒加载 ---------------- */
  let mermaidPromise = null;
  const mermaidCache = new Map();

  function ensureMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (mermaidPromise) return mermaidPromise;
    mermaidPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/mermaid.min.js';
      s.onload = () => resolve(window.mermaid);
      s.onerror = () => reject(new Error('mermaid 运行时加载失败'));
      document.head.appendChild(s);
    });
    return mermaidPromise;
  }

  async function renderMermaids(root) {
    const blocks = $$('.mermaid-block', root);
    if (!blocks.length || !MDV.state.prefs.mermaid) return;

    let mermaid;
    try { mermaid = await ensureMermaid(); } catch (err) { showMermaidError(blocks, err.message); return; }

    const dark = document.body.classList.contains('light') === false;
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'default',
        fontFamily: 'inherit',
        flowchart: { htmlLabels: false },
        suppressErrorRendering: true
      });
    } catch { /* 重复初始化无害 */ }

    let seq = 0;
    for (const block of blocks) {
      if (block.dataset.rendered === '1') continue;
      const b64 = block.dataset.graph || '';
      let code = '';
      try { code = decodeURIComponent(escape(atob(b64))); } catch { code = ''; }
      if (!code) continue;

      const cacheKey = `${dark ? 'd' : 'l'}:${b64}`;
      if (mermaidCache.has(cacheKey)) {
        block.innerHTML = mermaidCache.get(cacheKey);
        block.dataset.rendered = '1';
        continue;
      }

      try {
        const { svg } = await mermaid.render('mdv-mermaid-' + (++seq) + '-' + Date.now(), code);
        block.innerHTML = svg;
        block.dataset.rendered = '1';
        mermaidCache.set(cacheKey, svg);
      } catch (err) {
        block.innerHTML = '';
        block.appendChild(el('div', 'mermaid-error', '图表渲染失败：' + (err && err.message ? err.message : err)));
        const pre = el('pre', 'mermaid-src', code);
        block.appendChild(pre);
        block.dataset.rendered = '1';
      }
    }
  }

  function showMermaidError(blocks, msg) {
    blocks.forEach((b) => {
      b.innerHTML = '';
      b.appendChild(el('div', 'mermaid-error', msg));
    });
  }

  /* ---------------- front matter ---------------- */
  function prependFrontMatter(root, fm) {
    if (!fm) return;
    const details = el('details', 'front-matter');
    const summary = el('summary');
    summary.textContent = `YAML 元数据 · ${fm.lines} 行`;
    details.appendChild(summary);
    const pre = el('pre', 'front-matter-body');
    pre.textContent = fm.raw;
    details.appendChild(pre);
    root.insertBefore(details, root.firstChild);
  }

  /* ---------------- 滚动进度 ---------------- */
  function updateProgress() {
    if (!progress) return;
    const max = content.scrollHeight - content.clientHeight;
    const ratio = max > 0 ? MDV.clamp(content.scrollTop / max, 0, 1) : 0;
    progress.style.width = (ratio * 100).toFixed(2) + '%';
    progress.parentElement.style.opacity = max > 40 ? '1' : '0';
  }

  const onScroll = MDV.throttleRAF(() => {
    updateProgress();
    MDV.outline && MDV.outline.syncActive();
  });
  content.addEventListener('scroll', onScroll, { passive: true });

  /* ---------------- 主渲染 ---------------- */
  function render(tab, opts = {}) {
    const { anchor, scrollTop, restore } = opts;
    view.innerHTML = sanitize(tab.html);
    mapLinks(view, tab.path);
    wrapTables(view);
    enhanceCode(view);
    prependFrontMatter(view, tab.meta && tab.meta.frontMatter);

    if (MDV.outline) MDV.outline.build(tab.meta ? tab.meta.headings : []);

    // mermaid 异步实绘（失败不影响正文）
    if (tab.meta && tab.meta.hasMermaid) renderMermaids(view);

    requestAnimationFrame(() => {
      if (anchor) {
        const target = document.getElementById(anchor);
        if (target) {
          const r = target.getBoundingClientRect();
          const c = content.getBoundingClientRect();
          content.scrollTop += r.top - c.top - 12;
        }
      } else if (restore) {
        content.scrollTop = scrollTop || 0;
      } else {
        content.scrollTop = 0;
      }
      updateProgress();
      MDV.outline && MDV.outline.syncActive();
    });
  }

  function currentScroll() { return content.scrollTop; }

  /* ---------------- 点击 / 图片放大 ---------------- */
  view.addEventListener('click', (e) => {
    const img = e.target.closest('img.zoomable');
    if (img) { MDV.lightbox && MDV.lightbox.open(img.src, img.alt); return; }

    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();

    if (a.dataset.ext) { window.mdv.openExternal(a.dataset.ext); return; }

    if (a.dataset.anchor) {
      const t = document.getElementById(a.dataset.anchor);
      if (t) {
        const r = t.getBoundingClientRect();
        const c = content.getBoundingClientRect();
        content.scrollTop += r.top - c.top - 12;
      }
      return;
    }

    if (a.dataset.local) {
      const p = a.dataset.local;
      const hash = a.dataset.hash || '';
      if (/\.(md|markdown|mdown|mkd|mdx)$/i.test(p)) MDV.tabs.openPath(p, { anchor: hash, history: true, inPlace: true });
      else window.mdv.openPath(p);
    }
  });

  MDV.view = { render, currentScroll, updateProgress, copyText, renderMermaids, sanitize };
})();
