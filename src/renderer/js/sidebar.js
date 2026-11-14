'use strict';
/* 侧边栏：文件树（带层级缩进、筛选、定位当前文件）+ 大纲切换 */
(function () {
  const MDV = window.MDV;
  const { $, $$, el, baseName, normalizeWinPath, saveJSON } = MDV;

  const state = MDV.state;
  const sidebar = $('#sidebar');
  const tree = $('#sb-tree');
  const outline = $('#outline-list');
  const filterInput = $('#sb-filter');
  const rootLabel = $('#sb-root-name');

  const index = new Map();   // lower(path) -> { row, sub }

  /* ---------------- 基础 ---------------- */
  function setOpen(open) {
    state.sidebar.open = open;
    sidebar.hidden = !open;
    $('#btn-sidebar').classList.toggle('active', open);
    if (open) {
      setMode(state.sidebar.mode);
      if (state.sidebar.mode === 'files' && !tree.childElementCount && state.root) refresh();
    }
  }

  function toggle(mode) {
    if (mode && state.sidebar.open && state.sidebar.mode !== mode) { setMode(mode); return; }
    setOpen(!state.sidebar.open);
    if (state.sidebar.open && mode) setMode(mode);
  }

  function setMode(mode) {
    state.sidebar.mode = mode === 'outline' ? 'outline' : 'files';
    $$('.side-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.sidebar.mode));
    tree.hidden = state.sidebar.mode !== 'files';
    outline.hidden = state.sidebar.mode !== 'outline';
    filterInput.parentElement.hidden = state.sidebar.mode !== 'files';
    if (state.sidebar.mode === 'files' && !tree.childElementCount && state.root) refresh();
  }

  /* ---------------- 目录树 ---------------- */
  function iconDir() {
    return '<svg class="chev" width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>'
      + '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/></svg>';
  }
  function iconFile() {
    return '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M4 1.5h5L12.5 5v9.5a.9.9 0 0 1-.9.9H4.4a.9.9 0 0 1-.9-.9V2.4a.9.9 0 0 1 .9-.9z"/><path d="M9 1.5V5h3.5"/></svg>';
  }

  async function loadDir(dirPath, container, depth) {
    const res = await window.mdv.listDir(dirPath);
    if (!res.ok) return null;

    const frag = document.createDocumentFragment();
    for (const d of res.dirs) frag.appendChild(dirRow(d, depth));
    for (const f of res.mds) frag.appendChild(fileRow(f, depth));
    container.appendChild(frag);

    // 恢复记忆的展开状态
    for (const d of res.dirs) {
      if (state.expanded.has(d.path)) {
        const rec = index.get(d.path.toLowerCase());
        if (rec) await expand(d, rec, depth);
      }
    }
    return res;
  }

  function dirRow(node, depth) {
    const row = el('div', 'sb-item dir');
    row.style.paddingLeft = (8 + depth * 12) + 'px';
    row.dataset.path = node.path;
    row.innerHTML = iconDir() + '<span></span>';
    row.querySelector('span').textContent = node.name;
    row.title = node.path;

    const rec = { row, sub: null, depth, node };
    index.set(node.path.toLowerCase(), rec);

    row.addEventListener('click', () => {
      const open = row.classList.contains('open');
      if (open) collapse(node, rec);
      else expand(node, rec, depth);
    });
    return row;
  }

  async function expand(node, rec, depth) {
    rec.row.classList.add('open');
    state.expanded.add(node.path);
    persistExpanded();
    if (rec.sub) { rec.sub.hidden = false; return; }
    rec.sub = el('div', 'sb-sub');
    rec.sub.hidden = false;
    rec.row.after(rec.sub);
    await loadDir(node.path, rec.sub, depth + 1);
    applyFilter();
  }

  function collapse(node, rec) {
    rec.row.classList.remove('open');
    state.expanded.delete(node.path);
    persistExpanded();
    if (rec.sub) rec.sub.hidden = true;
  }

  function fileRow(node, depth) {
    const row = el('div', 'sb-item file');
    row.style.paddingLeft = (8 + depth * 12 + 16) + 'px';
    row.dataset.path = node.path;
    row.dataset.name = node.name.toLowerCase();
    row.innerHTML = iconFile() + '<span></span>';
    row.querySelector('span').textContent = node.name;
    row.title = node.path;
    index.set(node.path.toLowerCase(), { row, depth });
    row.addEventListener('click', () => MDV.tabs.openPath(node.path));
    return row;
  }

  /* 并发守卫：setOpen / setMode / revealPath 可能同时触发刷新，
     直接往 tree 里追加会造成同一文件重复出现多次 */
  let refreshPromise = null;
  let refreshSeq = 0;

  function refresh() {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  async function doRefresh() {
    if (!state.root) {
      tree.innerHTML = '<div class="sb-empty">还没有打开文件夹<br>可以从工具栏打开一个 .md 文件</div>';
      return;
    }
    const seq = ++refreshSeq;
    index.clear();
    rootLabel.textContent = baseName(state.root);
    rootLabel.title = state.root;

    // 先渲染到游离节点，读完再整体替换，避免中途刷新留下半截 DOM
    const holder = document.createElement('div');
    const res = await loadDir(state.root, holder, 0);
    if (seq !== refreshSeq) return;

    tree.innerHTML = '';
    if (!res) {
      tree.innerHTML = '<div class="sb-empty">无法读取该目录</div>';
      return;
    }
    tree.append(...Array.from(holder.childNodes));
    applyFilter();

    const tab = MDV.tabs && MDV.tabs.active();
    if (tab) revealPath(tab.path);
  }

  /** 展开从工作区根到目标文件的整条链路，并高亮该文件 */
  async function revealPath(path) {
    const active = normalizeWinPath(path);
    const lower = active.toLowerCase();

    if (state.root && !lower.startsWith(state.root.toLowerCase())) {
      state.root = MDV.dirname(active);
      await refresh();
      if (state.sidebar.open) setMode('files');
    }
    if (!tree.childElementCount) await refresh();

    let cur = index.get(lower);
    if (!cur) {
      // 逐段展开
      const rootLower = (state.root || '').toLowerCase();
      if (!state.root || !lower.startsWith(rootLower)) return;
      const rel = active.slice(state.root.length).replace(/^[\\/]+/, '');
      const segs = rel.split(/[\\/]/).slice(0, -1);
      let dir = state.root;
      for (const seg of segs) {
        dir = dir + '\\' + seg;
        const rec = index.get(dir.toLowerCase());
        if (!rec) break;
        if (!rec.row.classList.contains('open')) await expand(rec.node, rec, rec.depth);
      }
      cur = index.get(lower);
    }

    $$('.sb-item.file.active', tree).forEach((n) => n.classList.remove('active'));
    if (cur && cur.row) {
      cur.row.classList.add('active');
      if (state.sidebar.open && state.sidebar.mode === 'files') {
        cur.row.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function persistExpanded() {
    saveJSON('mdv.expanded', Array.from(state.expanded).slice(-200));
  }

  /* ---------------- 筛选 ---------------- */
  function applyFilter() {
    const q = filterInput.value.trim().toLowerCase();
    const files = $$('.sb-item.file', tree);
    const dirs = $$('.sb-item.dir', tree);

    if (!q) {
      files.forEach((f) => { f.hidden = false; });
      // 恢复时按「是否展开」决定子容器可见性，不要把所有子目录都摊开
      dirs.forEach((d) => {
        d.hidden = false;
        const rec = index.get((d.dataset.path || '').toLowerCase());
        if (rec && rec.sub) rec.sub.hidden = !d.classList.contains('open');
      });
      return;
    }

    files.forEach((f) => { f.hidden = !(f.dataset.name || '').includes(q); });

    // 目录：有可见子孙才显示；从最深层往上算
    for (let i = dirs.length - 1; i >= 0; i--) {
      const d = dirs[i];
      const rec = index.get((d.dataset.path || '').toLowerCase());
      const sub = rec && rec.sub;
      const visible = sub ? $$('.sb-item', sub).some((n) => !n.hidden) : false;
      d.hidden = !visible;
      if (sub) sub.hidden = !visible;
    }
  }

  filterInput.addEventListener('input', MDV.debounce(applyFilter, 90));
  $('#sb-open-folder').addEventListener('click', () => MDV.app.openFolder());

  function onActiveChange(tab) {
    if (!tab) return;
    if (!state.root) state.root = MDV.dirname(tab.path);
    rootLabel.textContent = baseName(state.root);
    rootLabel.title = state.root;
    if (state.sidebar.open) revealPath(tab.path);
  }

  MDV.sidebar = { setOpen, toggle, setMode, refresh, revealPath, onActiveChange, applyFilter };
})();
