'use strict';
/* Markdown 查看器 — 渲染进程逻辑 */

const $ = (sel) => document.querySelector(sel);

const els = {
  tabLabel: $('#tab-label'),
  tabClose: $('#tab-close'),
  btnOpen: $('#btn-open'),
  btnSidebar: $('#btn-sidebar'),
  btnMore: $('#btn-more'),
  sidebar: $('#sidebar'),
  sbCurrent: $('#sb-current'),
  sbTree: $('#sb-tree'),
  content: $('#content'),
  welcome: $('#welcome'),
  wlOpen: $('#wl-open'),
  wlRecents: $('#wl-recents'),
  wlRecentList: $('#wl-recent-list'),
  view: $('#view'),
  moreMenu: null
};

const state = {
  file: null,          // 当前文件绝对路径
  html: null,          // 当前渲染的 html（用于切回）
  scrollTop: new Map(),// 每个文件的滚动位置（会话内）
  recents: loadJSON('mdv.recents', []),
  zoom: loadJSON('mdv.zoom', 1),
  sidebarOpen: false,
  expanded: new Set()
};

function loadJSON(key, dft) {
  try { return JSON.parse(localStorage.getItem(key)) ?? dft; }
  catch { return dft; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch { /* ignore */ }
}

/* ================= 文件打开 ================= */
function toast(msg) {
  const el = document.createElement('div');
  el.id = 'mdv-toast';
  el.textContent = msg;
  if (!document.getElementById('mdv-toast-style')) {
    const st = document.createElement('style');
    st.id = 'mdv-toast-style';
    st.textContent = '#mdv-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);' +
      'background:#3a2b2b;color:#f1b8b8;border:1px solid #6e4444;border-radius:6px;padding:9px 16px;' +
      'font-size:13px;z-index:200;box-shadow:0 6px 18px rgba(0,0,0,.5)}';
    document.head.appendChild(st);
  }
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function openFile(p, opts = {}) {
  const res = await window.mdv.readFile(p);
  if (!res.ok) {
    toast(res.message || '无法打开文件');
    return;
  }
  openFromText(p, res.text, opts);
}

function openFromText(p, text, opts = {}) {
  if (state.file) {
    state.scrollTop.set(state.file, els.view.scrollTop);
  }

  const html = window.mdv.renderMarkdown(text);

  state.file = p;
  state.html = html;
  document.title = `${baseName(p)} — Markdown 查看器`;
  els.tabLabel.textContent = '预览 ' + baseName(p);
  els.tabLabel.title = p;

  renderView(html);
  pushRecent(p);
  renderRecents();
  buildSidebar(p);
  if (state.sidebarOpen) loadTree(dirname(p));

  els.welcome.hidden = true;
  els.view.hidden = false;
  els.view.scrollTop = opts.restore ? (state.scrollTop.get(p) || 0) : 0;
  els.content.scrollTop = 0;

  if (opts.watch !== false) startWatch();
}

function renderView(html) {
  els.view.innerHTML = html;
  sanitize(els.view);
  resolveAssets(els.view);
}

/* 轻量清洗：本地查看器不执行文档内脚本 */
function sanitize(root) {
  root.querySelectorAll('script, iframe, object, embed, link, style, base, form').forEach(n => n.remove());
  root.querySelectorAll('*').forEach(n => {
    for (const attr of [...n.attributes]) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim();
      if (name.startsWith('on')) n.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^(javascript|vbscript|data:text\/html)/i.test(val)) {
        n.removeAttribute(attr.name);
      }
    }
  });
}

/* 相对路径 → file:// 绝对路径；记录站外链接 */
function resolveAssets(root) {
  if (!state.file) return;
  const dir = dirname(state.file);
  root.querySelectorAll('img[src]').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (/^(https?:|data:|blob:|file:)/i.test(src)) return;
    img.src = fileURL(joinPath(dir, src));
  });
  root.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || '';
    a.removeAttribute('target');
    if (/^https?:/i.test(href)) { a.dataset.ext = href; return; }
    if (/^#/.test(href)) { a.dataset.anchor = href.slice(1); return; }
    if (/^(mailto:)/i.test(href)) return;
    if (/^file:/i.test(href)) {
      const p = decodeURIComponent(href.replace(/^file:\/\/\//, ''));
      a.dataset.local = p.replace(/\//g, '\\');
      return;
    }
    a.dataset.local = joinPath(dir, href);
  });
}

function fileURL(p) {
  let u = p.replace(/\\/g, '/');
  try { u = encodeURI(u).replace(/#/g, '%23').replace(/\?/g, '%3F'); } catch { /* ignore */ }
  return 'file:///' + u.replace(/^\/+/, '');
}

els.view.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.ext) { window.mdv.openExternal(a.dataset.ext); return; }
  if (a.dataset.anchor) {
    const t = document.getElementById(a.dataset.anchor);
    if (t) t.scrollIntoView({ block: 'start' });
    return;
  }
  if (a.dataset.local) {
    const p = a.dataset.local;
    if (/\.(md|markdown|mdown|mkd)$/i.test(p)) openFile(p);
    else window.mdv.openPath(p);
  }
});

/* ================= 最近文件 ================= */
function pushRecent(p) {
  state.recents = [p, ...state.recents.filter(x => x.toLowerCase() !== p.toLowerCase())].slice(0, 10);
  saveJSON('mdv.recents', state.recents);
}
function renderRecents() {
  if (!state.recents.length) { els.wlRecents.hidden = true; return; }
  els.wlRecents.hidden = false;
  els.wlRecentList.innerHTML = '';
  for (const p of state.recents.slice(0, 6)) {
    const li = document.createElement('li');
    li.textContent = baseName(p) + '　·　' + p;
    li.title = p;
    li.addEventListener('click', () => openFile(p));
    els.wlRecentList.appendChild(li);
  }
}

/* ================= 侧边栏 ================= */
async function buildSidebar(currentFile) {
  els.sbCurrent.innerHTML = '';
  const folder = document.createElement('span');
  folder.className = 'sb-folder';
  folder.textContent = dirname(currentFile);
  const name = document.createElement('span');
  name.textContent = baseName(currentFile);
  els.sbCurrent.append(folder, name);
}

async function loadTree(dir) {
  const res = await window.mdv.listDir(dir);
  els.sbTree.innerHTML = '';
  if (!res.ok) return;
  const frag = document.createDocumentFragment();
  for (const d of res.dirs) frag.appendChild(itemNode(d));
  for (const f of res.mds) frag.appendChild(itemNode(f));
  els.sbTree.appendChild(frag);
}

function itemNode(node) {
  const div = document.createElement('div');
  div.className = 'sb-item' + (node.dir ? ' dir' : '') + (!node.dir && state.file && node.path === state.file ? ' active' : '');
  if (node.dir) {
    div.innerHTML = `<svg class="chev" width="10" height="10" viewBox="0 0 10 10"><path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12z"/></svg>
      <span></span>`;
    div.querySelector('span').textContent = node.name;
    div.addEventListener('click', () => toggleDir(node, div));
  } else {
    div.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M4 1.5h5L12.5 5v9.5a.9.9 0 0 1-.9.9H4.4a.9.9 0 0 1-.9-.9V2.4a.9.9 0 0 1 .9-.9z"/><path d="M9 1.5V5h3.5"/></svg>
      <span></span>`;
    div.querySelector('span').textContent = node.name;
    div.title = node.path;
    div.addEventListener('click', () => openFile(node.path));
  }
  return div;
}

async function toggleDir(node, el) {
  const open = el.classList.toggle('open');
  const next = el.nextElementSibling;
  if (next && next.classList.contains('sb-sub')) {
    if (!open) { next.remove(); state.expanded.delete(node.path); }
    return;
  }
  if (!open) return;
  state.expanded.add(node.path);
  const res = await window.mdv.listDir(node.path);
  if (!res.ok) return;
  const sub = document.createElement('div');
  sub.className = 'sb-sub';
  for (const d of res.dirs) sub.appendChild(itemNode(d));
  for (const f of res.mds) sub.appendChild(itemNode(f));
  sub.querySelectorAll('.sb-item:not(.dir)').forEach(i => i.style.paddingLeft = '38px');
  el.after(sub);
}

/* ================= 文件变动自动刷新 ================= */
let watchTimer = null;
function startWatch() {
  stopWatch();
  watchTimer = setInterval(async () => {
    if (!state.file) return stopWatch();
    const res = await window.mdv.readFile(state.file);
    if (res.ok) {
      const html = window.mdv.renderMarkdown(res.text);
      if (html !== state.html) {
        state.html = html;
        const sc = els.view.scrollTop;
        renderView(html);
        els.view.scrollTop = Math.min(sc, els.view.scrollHeight);
      }
    }
  }, 2000);
}
function stopWatch() { if (watchTimer) { clearInterval(watchTimer); watchTimer = null; } }

/* ================= 工具栏 ================= */
els.tabClose.addEventListener('click', () => {
  stopWatch();
  state.file = null;
  els.view.hidden = true;
  els.view.innerHTML = '';
  els.welcome.hidden = false;
  els.tabLabel.textContent = '预览';
  document.title = 'Markdown 查看器';
  els.sbCurrent.innerHTML = '';
  els.sbTree.innerHTML = '';
  renderRecents();
});

els.btnOpen.addEventListener('click', openViaDialog);
els.wlOpen.addEventListener('click', openViaDialog);

async function openViaDialog() {
  const p = await window.mdv.openFileDialog();
  if (p) openFile(p);
}

els.btnSidebar.addEventListener('click', toggleSidebar);
function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  els.sidebar.hidden = !state.sidebarOpen;
  els.btnSidebar.classList.toggle('active', state.sidebarOpen);
  if (state.sidebarOpen && state.file) loadTree(dirname(state.file));
}

els.btnMore.addEventListener('click', (e) => {
  e.stopPropagation();
  if (els.moreMenu) { closeMenu(); return; }
  els.moreMenu = document.createElement('div');
  els.moreMenu.id = 'more-menu';
  els.moreMenu.innerHTML = `
    <button data-act="open">打开文件…</button>
    <button data-act="folder">在资源管理器中显示</button>
    <button data-act="default">设为默认 .md 打开程序…</button>
    <div class="sep"></div>
    <button data-act="zin">放大　Ctrl + =</button>
    <button data-act="zout">缩小　Ctrl + -</button>
    <button data-act="zreset">重置缩放　Ctrl + 0</button>
    <div class="sep"></div>
    <button data-act="about">关于</button>`;
  document.body.appendChild(els.moreMenu);
  els.moreMenu.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    closeMenu();
    const act = b.dataset.act;
    if (act === 'open') openViaDialog();
    else if (act === 'folder' && state.file) window.mdv.showInFolder(state.file);
    else if (act === 'default') window.mdv.openExternal('ms-settings:defaultapps');
    else if (act === 'zin') zoom('in');
    else if (act === 'zout') zoom('out');
    else if (act === 'zreset') zoom('reset');
    else if (act === 'about') $('#about-dlg').showModal();
  });
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
});
function closeMenu() {
  if (els.moreMenu) { els.moreMenu.remove(); els.moreMenu = null; }
}

/* ================= 缩放 ================= */
function zoom(cmd) {
  let z = state.zoom;
  if (cmd === 'in') z = Math.min(2.4, +(z + 0.1).toFixed(2));
  else if (cmd === 'out') z = Math.max(0.5, +(z - 0.1).toFixed(2));
  else z = 1;
  state.zoom = z;
  saveJSON('mdv.zoom', z);
  window.mdv.setZoom(z);
}

// Ctrl + 滚轮 / 触摸板双指捏合缩放字体
$('#content').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const before = state.zoom;
  zoom(e.deltaY < 0 ? 'in' : 'out');
  if (state.zoom !== before) showZoomBadge();
}, { passive: false });

let badgeTimer = null;
function showZoomBadge() {
  let b = document.getElementById('zoom-badge');
  if (!b) {
    b = document.createElement('div');
    b.id = 'zoom-badge';
    const st = document.createElement('style');
    st.id = 'zoom-badge-style';
    st.textContent = '#zoom-badge{position:fixed;top:56px;right:24px;background:rgba(36,38,40,.95);' +
      'border:1px solid #3a3c3f;color:#d1d3db;font-size:12px;padding:4px 10px;border-radius:12px;' +
      'z-index:150;pointer-events:none}';
    document.head.appendChild(st);
  }
  b.textContent = Math.round(state.zoom * 100) + '%';
  b.style.display = 'block';
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => { b.style.display = 'none'; }, 900);
}

window.mdv.onZoom(zoom);
window.mdv.onMenu((cmd) => {
  if (cmd === 'open') openViaDialog();
  else if (cmd === 'toggle-sidebar') toggleSidebar();
  else if (cmd === 'about') $('#about-dlg').showModal();
});
window.mdv.onOpenFile((p) => openFile(p));

/* ================= 拖放 ================= */
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add('dragging');
});
window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = [...(e.dataTransfer?.files || [])].find(f => /\.(md|markdown|mdown|mkd)$/i.test(f.name));
  if (f) openFile(f.path);
});

/* ================= 工具函数 ================= */
function baseName(p) { return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p; }
function dirname(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}
function joinPath(dir, rel) {
  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\')) return rel;
  return dir.replace(/[\\/]+$/, '') + '\\' + rel.replace(/^[\\/]+/, '');
}

/* ================= 启动 ================= */
window.mdv.setZoom(state.zoom);
renderRecents();

/* ================= 主题切换（左下角按钮） ================= */
const themeBtn = $('#theme-toggle');
function applyTheme(t) {
  document.body.classList.toggle('light', t === 'light');
  window.mdv.applyTheme(t);
}
let theme = loadJSON('mdv.theme', 'dark');
if (theme !== 'light' && theme !== 'dark') theme = 'dark';
applyTheme(theme);
themeBtn.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  saveJSON('mdv.theme', theme);
  applyTheme(theme);
});
