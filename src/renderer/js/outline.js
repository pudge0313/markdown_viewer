'use strict';
/* 大纲：标题树 → 点击跳转 → 滚动跟随高亮 */
(function () {
  const MDV = window.MDV;
  const { $, $$, el } = MDV;

  const list = $('#outline-list');
  let items = [];       // [{ id, depth, el }]
  let activeId = null;

  function build(headings) {
    list.innerHTML = '';
    items = [];
    activeId = null;

    if (!headings || !headings.length) {
      const empty = el('div', 'ol-empty', '本文档没有标题');
      list.appendChild(empty);
      return;
    }

    const minDepth = Math.min(...headings.map((h) => h.depth));
    const frag = document.createDocumentFragment();

    for (const h of headings) {
      const node = el('div', 'ol-item');
      node.textContent = h.text || '(无标题)';
      node.title = h.text || '';
      node.dataset.id = h.id;
      node.style.paddingLeft = (8 + (h.depth - minDepth) * 12) + 'px';
      if (h.depth - minDepth === 0) node.classList.add('lv1');
      node.addEventListener('click', () => jumpTo(h.id));
      frag.appendChild(node);
      items.push({ id: h.id, depth: h.depth, el: node });
    }
    list.appendChild(frag);
    syncActive();
  }

  function jumpTo(id) {
    const target = document.getElementById(id);
    const content = $('#content');
    if (!target || !content) return;
    const r = target.getBoundingClientRect();
    const c = content.getBoundingClientRect();
    content.scrollTop += r.top - c.top - 16;
    setActive(id);
  }

  function setActive(id) {
    if (id === activeId) return;
    activeId = id;
    for (const it of items) it.el.classList.toggle('active', it.id === id);

    const cur = items.find((it) => it.id === id);
    if (cur && MDV.state.sidebar.open && MDV.state.sidebar.mode === 'outline') {
      const box = list;
      const top = cur.el.offsetTop;
      const h = cur.el.offsetHeight;
      if (top < box.scrollTop || top + h > box.scrollTop + box.clientHeight) {
        box.scrollTop = top - box.clientHeight / 2 + h / 2;
      }
    }
  }

  /** 滚动时找「最后一个越过顶部基准线的标题」——二分查找，每帧最多 log2(n) 次布局读取 */
  function syncActive() {
    if (!items.length) return;
    const content = $('#content');
    if (!content) return;
    const baseY = content.getBoundingClientRect().top + 90;

    let lo = 0, hi = items.length - 1, found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const node = document.getElementById(items[mid].id);
      if (!node) {
        // 渲染未完成或标题被清理，重排一次即可
        lo = mid + 1;
        continue;
      }
      if (node.getBoundingClientRect().top <= baseY) { found = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    setActive(items[found].id);
  }

  MDV.outline = { build, syncActive, jumpTo, get items() { return items; } };
})();
