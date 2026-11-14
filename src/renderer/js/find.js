'use strict';
/* 文档内查找：CSS Custom Highlight API（不改动 DOM，避免破坏渲染与滚动位置） */
(function () {
  const MDV = window.MDV;
  const { $, el } = MDV;

  const bar = $('#findbar');
  const input = $('#find-input');
  const counter = $('#find-count');

  const MAX_HITS = 3000;
  const state = { hits: [], index: -1, truncated: false, query: '', supported: !!(window.CSS && CSS.highlights) };

  function textNodes(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('script, style, .code-bar, .mermaid-block .mermaid-error')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  /** 把整棵树拼成一条字符串，并记录每个文本节点的起止偏移 */
  function buildIndex(root) {
    const nodes = textNodes(root);
    let text = '';
    const map = [];
    for (const node of nodes) {
      const start = text.length;
      text += node.nodeValue;
      map.push({ node, start, end: text.length });
    }
    return { text, map };
  }

  function locate(map, offset) {
    let lo = 0, hi = map.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const rec = map[mid];
      if (offset < rec.start) hi = mid - 1;
      else if (offset >= rec.end) lo = mid + 1;
      else return rec;
    }
    return null;
  }

  function clearHighlights() {
    if (!state.supported) return;
    CSS.highlights.delete('mdv-find');
    CSS.highlights.delete('mdv-find-active');
  }

  function paint() {
    if (!state.supported) return;
    clearHighlights();
    if (!state.hits.length) return;
    const all = new Highlight(...state.hits.map((h) => h.range));
    CSS.highlights.set('mdv-find', all);
    const active = state.hits[state.index];
    if (active) CSS.highlights.set('mdv-find-active', new Highlight(active.range));
  }

  function scrollToActive() {
    const hit = state.hits[state.index];
    if (!hit) return;
    const rect = hit.range.getBoundingClientRect();
    const content = $('#content');
    const c = content.getBoundingClientRect();
    if (!rect.height && !rect.width) return;
    content.scrollTop += rect.top - c.top - c.height / 2;
  }

  function updateCounter() {
    if (!state.query) { counter.textContent = ''; return; }
    if (!state.hits.length) { counter.textContent = '无结果'; return; }
    counter.textContent = `${state.index + 1}/${state.hits.length}${state.truncated ? '+' : ''}`;
  }

  function search(query) {
    clearHighlights();
    state.hits = [];
    state.index = -1;
    state.truncated = false;

    const q = String(query || '');
    state.query = q;
    if (input.value !== q) input.value = q;
    if (q.length < 1) { updateCounter(); return; }

    const root = $('#view');
    if (!root) return;
    const { text, map } = buildIndex(root);
    const hay = text.toLowerCase();
    const needle = q.toLowerCase();

    let from = 0;
    while (state.hits.length < MAX_HITS) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      const a = locate(map, at);
      const b = locate(map, at + needle.length - 1);
      if (a && b) {
        const range = document.createRange();
        range.setStart(a.node, at - a.start);
        range.setEnd(b.node, at + needle.length - b.start);
        state.hits.push({ range });
      }
      from = at + Math.max(1, needle.length);
    }
    if (state.hits.length >= MAX_HITS) state.truncated = true;

    if (state.hits.length) {
      state.index = 0;
      paint();
      scrollToActive();
    }
    updateCounter();
  }

  function step(dir) {
    if (!state.hits.length) return;
    state.index = (state.index + dir + state.hits.length) % state.hits.length;
    paint();
    scrollToActive();
    updateCounter();
  }

  function open() {
    bar.hidden = false;
    const tab = MDV.tabs && MDV.tabs.active();
    const selected = window.getSelection && String(window.getSelection());
    if (selected && selected.length < 60 && selected.indexOf('\n') < 0) input.value = selected;
    input.focus();
    input.select();
    if (input.value) search(input.value);
    MDV.state.find.open = true;
  }

  function close() {
    bar.hidden = true;
    clearHighlights();
    state.hits = [];
    state.index = -1;
    state.query = '';
    counter.textContent = '';
    MDV.state.find.open = false;
    const view = $('#view');
    if (view) view.focus();
  }

  /** 内容重渲染后调用：清掉旧 Range（DOM 已替换，旧 Range 失效） */
  function reset() {
    state.hits = [];
    state.index = -1;
    clearHighlights();
    counter.textContent = '';
    if (!bar.hidden && input.value) search(input.value);
  }

  input.addEventListener('input', MDV.debounce(() => search(input.value), 110));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  $('#find-next').addEventListener('click', () => step(1));
  $('#find-prev').addEventListener('click', () => step(-1));
  $('#find-close').addEventListener('click', close);

  MDV.find = { open, close, reset, search, step, get openState() { return !bar.hidden; } };
})();
