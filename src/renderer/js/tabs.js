'use strict';
/* 标签页 + 文件监听 + 导航历史 */
(function () {
  const MDV = window.MDV;
  const { $, el, baseName, dirname, normalizeWinPath, loadJSON, saveJSON } = MDV;

  const tabbar = $('#tabs');
  const view = $('#view');
  const welcome = $('#welcome');
  const banner = $('#file-banner');

  const LARGE_FILE = 1.5 * 1024 * 1024;

  const state = MDV.state;

  const activeTab = () => state.tabs.find((t) => t.key === state.activeKey) || null;

  /* ---------------- 渲染 ---------------- */
  function renderTabBar() {
    tabbar.innerHTML = '';
    for (const tab of state.tabs) {
      const node = el('div', 'tab' + (tab.key === state.activeKey ? ' active' : ''));
      node.dataset.key = tab.key;
      node.title = tab.path + (tab.missing ? '（文件不存在）' : '');

      const icon = el('span', 'tab-ico');
      icon.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 1.8h5L12.2 5v9.2H4z"/><path d="M9 1.8V5h3.2"/></svg>';
      node.appendChild(icon);

      const name = el('span', 'tab-name', tab.name);
      if (tab.missing) name.textContent = tab.name + ' ⚠';
      node.appendChild(name);

      const x = el('button', 'tab-x');
      x.type = 'button';
      x.title = '关闭标签 (Ctrl+W)';
      x.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>';
      node.appendChild(x);

      tabbar.appendChild(node);
    }
    const activeNode = tabbar.querySelector('.tab.active');
    if (activeNode) activeNode.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function showWelcome() {
    view.hidden = true;
    welcome.hidden = false;
    document.title = 'Markdown 查看器';
    $('#outline-list').innerHTML = '<div class="ol-empty">打开文档后显示大纲</div>';
    MDV.view.updateProgress();
  }

  function syncChrome() {
    const tab = activeTab();
    welcome.hidden = !!tab;
    view.hidden = !tab;
    if (tab) document.title = `${tab.name} — Markdown 查看器`;
    else document.title = 'Markdown 查看器';
    renderTabBar();
    MDV.sidebar && MDV.sidebar.onActiveChange(tab);
    MDV.find && MDV.find.reset();
    syncWatch();
    persistSession();
  }

  /* ---------------- 打开 / 渲染 ---------------- */
  function renderText(text, opts) {
    const { highlight, math, breaks } = state.prefs;
    const big = (opts && opts.size > LARGE_FILE) && !state.highlightLarge;
    return window.mdv.renderMarkdown(text, {
      highlight: highlight && !big,
      math,
      breaks
    });
  }

  async function openPath(target, opts = {}) {
    const { anchor = '', history = false, inPlace = false, activateNow = true } = opts;
    const path = normalizeWinPath(target);
    if (!path) return false;

    const existing = state.tabs.find((t) => t.key === path.toLowerCase());
    if (existing) {
      if (existing.missing) await reloadTab(existing);
      if (activateNow) activate(existing.key, { anchor });
      if (history) pushHistory(existing, { path: existing.path, anchor });
      return true;
    }

    const res = await window.mdv.readFile(path);
    if (!res.ok) {
      MDV.toast(res.message || '无法打开文件');
      return false;
    }

    const rendered = renderText(res.text, { size: res.size });
    if (res.size > LARGE_FILE && !state.highlightLarge) {
      MDV.toast('文档较大，已关闭语法高亮以保证滚动流畅', 'warn');
    }

    const tab = {
      key: res.path.toLowerCase(),
      path: res.path,
      name: res.name || baseName(res.path),
      text: res.text,
      html: rendered.html,
      meta: rendered,
      mtime: res.mtime,
      size: res.size,
      scrollTop: 0,
      history: [{ path: res.path, anchor }],
      pos: 0,
      missing: false
    };
    const current = activeTab();
    if (inPlace && current) {
      // 文档内链接：在当前标签内前进，保留历史栈（浏览器语义）
      tab.history = current.history.slice(0, current.pos + 1);
      tab.pos = tab.history.length - 1;
      pushHistory(tab, { path: tab.path, anchor });
      // 同一文件已在别的标签打开时先移除，避免 key 冲突
      const dup = state.tabs.findIndex((t) => t.key === tab.key && t !== current);
      if (dup >= 0) state.tabs.splice(dup, 1);
      const at = state.tabs.indexOf(current);
      state.tabs.splice(at >= 0 ? at : state.tabs.length, 1, tab);
      state.activeKey = tab.key;
    } else {
      state.tabs.push(tab);
    }
    pushRecent(res.path);

    if (!state.root) state.root = dirname(res.path);

    if (activateNow) {
      activate(tab.key, { anchor });
    } else {
      renderTabBar();
      persistSession();
    }
    return true;
  }

  function pushHistory(tab, entry) {
    const last = tab.history[tab.pos];
    if (last && last.path === entry.path && last.anchor === entry.anchor) return;
    tab.history = tab.history.slice(0, tab.pos + 1);
    tab.history.push(entry);
    tab.pos = tab.history.length - 1;
    if (tab.history.length > 60) { tab.history.shift(); tab.pos--; }
  }

  function activate(key, opts = {}) {
    const tab = state.tabs.find((t) => t.key === key);
    if (!tab) return;

    const prev = activeTab();
    if (prev && prev !== tab) prev.scrollTop = MDV.view.currentScroll();

    state.activeKey = tab.key;
    hideBanner();

    MDV.view.render(tab, {
      anchor: opts.anchor || '',
      restore: !opts.anchor,
      scrollTop: tab.scrollTop
    });

    syncChrome();
  }

  function cycle(dir) {
    if (state.tabs.length < 2) return;
    const i = state.tabs.findIndex((t) => t.key === state.activeKey);
    const next = (i + dir + state.tabs.length) % state.tabs.length;
    activate(state.tabs[next].key);
  }

  function closeTab(key) {
    const i = state.tabs.findIndex((t) => t.key === key);
    if (i < 0) return;
    const wasActive = state.tabs[i].key === state.activeKey;
    state.tabs.splice(i, 1);

    if (!state.tabs.length) {
      state.activeKey = null;
      showWelcome();
      renderTabBar();
      MDV.sidebar && MDV.sidebar.onActiveChange(null);
      syncWatch();
      persistSession();
      return;
    }
    if (wasActive) {
      const nextTab = state.tabs[Math.min(i, state.tabs.length - 1)];
      activate(nextTab.key);
    } else {
      renderTabBar();
      persistSession();
    }
  }

  function closeActive() {
    if (state.activeKey) closeTab(state.activeKey);
  }

  async function reloadTab(tab) {
    const res = await window.mdv.readFile(tab.path);
    if (!res.ok) { tab.missing = true; showBanner('文件已被移动或删除', true); return false; }
    const rendered = renderText(res.text, { size: res.size });
    tab.text = res.text;
    tab.html = rendered.html;
    tab.meta = rendered;
    tab.mtime = res.mtime;
    tab.size = res.size;
    tab.missing = false;
    return true;
  }

  async function reloadActive() {
    const tab = activeTab();
    if (!tab) return;
    const scroll = MDV.view.currentScroll();
    const ok = await reloadTab(tab);
    if (!ok) return;
    hideBanner();
    MDV.view.render(tab, { restore: true, scrollTop: scroll });
    MDV.toast('已重新加载');
  }

  /* ---------------- 外部修改 ---------------- */
  let watchSeq = 0;
  async function syncWatch() {
    const seq = ++watchSeq;
    const tab = activeTab();
    if (!tab) { window.mdv.unwatchFile(); return; }
    await window.mdv.watchFile(tab.path);
    if (seq !== watchSeq) return;
  }

  async function onFileChanged(ev) {
    const tab = activeTab();
    if (!tab || ev.path.toLowerCase() !== tab.path.toLowerCase()) return;

    if (!ev.exists) {
      tab.missing = true;
      renderTabBar();
      showBanner('文件已被移动或删除，内容为最后一次读取的结果。', true);
      return;
    }
    if (Math.abs(ev.mtime - tab.mtime) < 1) return;

    const res = await window.mdv.readFile(tab.path);
    if (!res.ok) {
      tab.missing = true;
      showBanner('文件读取失败：' + (res.message || '未知错误'), true);
      return;
    }

    const rendered = renderText(res.text, { size: res.size });
    tab.mtime = res.mtime;
    tab.size = res.size;
    if (rendered.html === tab.html) return;

    const scroll = MDV.view.currentScroll();
    tab.text = res.text;
    tab.html = rendered.html;
    tab.meta = rendered;
    MDV.view.render(tab, { restore: true, scrollTop: scroll });
    renderTabBar();
    MDV.toast('文件已更新');
  }

  /** 偏好变化后按当前文本重新渲染（不重新读盘） */
  function rerender(msg) {
    const tab = activeTab();
    if (!tab) return;
    const scroll = MDV.view.currentScroll();
    const rendered = renderText(tab.text, { size: tab.size });
    tab.html = rendered.html;
    tab.meta = rendered;
    MDV.view.render(tab, { restore: true, scrollTop: scroll });
    renderTabBar();
    if (msg) MDV.toast(msg);
  }

  /* ---------------- 提示条 ---------------- */
  function showBanner(text, withReload) {
    banner.innerHTML = '';
    const msg = el('span', 'fb-msg', text);
    banner.appendChild(msg);
    if (withReload) {
      const r = el('button', 'fb-btn', '重新加载');
      r.type = 'button';
      r.addEventListener('click', () => reloadActive());
      banner.appendChild(r);
    }
    const c = el('button', 'fb-btn ghost', '关闭标签');
    c.type = 'button';
    c.addEventListener('click', () => closeActive());
    banner.appendChild(c);
    banner.hidden = false;
  }
  function hideBanner() { banner.hidden = true; banner.innerHTML = ''; }

  /* ---------------- 历史导航 ---------------- */
  async function goHistory(dir) {
    const tab = activeTab();
    if (!tab) return;
    const next = tab.pos + dir;
    if (next < 0 || next >= tab.history.length) {
      MDV.toast(dir < 0 ? '没有更早的记录了' : '没有更新的记录了');
      return;
    }
    tab.pos = next;
    const entry = tab.history[next];
    if (entry.path.toLowerCase() === tab.path.toLowerCase()) {
      const target = entry.anchor ? document.getElementById(entry.anchor) : null;
      const content = $('#content');
      if (target) {
        const r = target.getBoundingClientRect();
        const c = content.getBoundingClientRect();
        content.scrollTop += r.top - c.top - 16;
      } else {
        content.scrollTop = 0;
      }
      return;
    }
    await openPath(entry.path, { anchor: entry.anchor, history: false, inPlace: true });
    const reopened = activeTab();
    if (reopened) { reopened.history = tab.history; reopened.pos = tab.pos; }
  }

  /* ---------------- 最近文件 ---------------- */
  function pushRecent(p) {
    state.recents = [p, ...state.recents.filter((x) => x.toLowerCase() !== p.toLowerCase())].slice(0, 12);
    saveJSON('mdv.recents', state.recents);
    renderRecents();
  }

  function renderRecents() {
    const box = $('#wl-recents');
    const list = $('#wl-recent-list');
    if (!box || !list) return;
    list.innerHTML = '';
    if (!state.recents.length) { box.hidden = true; return; }
    box.hidden = false;
    for (const p of state.recents.slice(0, 7)) {
      const li = el('li');
      const name = el('span', 'rec-name', baseName(p));
      const dir = el('span', 'rec-dir', dirname(p));
      li.append(name, dir);
      li.title = p;
      li.addEventListener('click', () => openPath(p));
      list.appendChild(li);
    }
  }

  /* ---------------- 会话恢复 ---------------- */
  const persistSession = MDV.debounce(() => {
    saveJSON('mdv.session', {
      paths: state.tabs.map((t) => t.path),
      active: state.activeKey
    });
  }, 400);

  async function restoreSession() {
    const sess = loadJSON('mdv.session', null);
    if (!sess || !Array.isArray(sess.paths) || !sess.paths.length) return false;
    let restored = 0;
    for (const p of sess.paths.slice(0, 8)) {
      const ok = await openPath(p, { activateNow: false });
      if (ok) restored++;
    }
    if (!restored) return false;
    const key = sess.active && state.tabs.some((t) => t.key === String(sess.active).toLowerCase())
      ? String(sess.active).toLowerCase()
      : state.tabs[0].key;
    activate(key);
    return true;
  }

  /* ---------------- 事件绑定 ---------------- */
  tabbar.addEventListener('click', (e) => {
    const node = e.target.closest('.tab');
    if (!node) return;
    if (e.target.closest('.tab-x')) { closeTab(node.dataset.key); return; }
    activate(node.dataset.key);
  });
  tabbar.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const node = e.target.closest('.tab');
    if (node) { e.preventDefault(); closeTab(node.dataset.key); }
  });
  tabbar.addEventListener('wheel', (e) => {
    if (!e.deltaY) return;
    tabbar.scrollLeft += e.deltaY;
  }, { passive: true });

  window.mdv.onFileChanged(onFileChanged);

  MDV.tabs = {
    openPath, activate, closeTab, closeActive, cycle, reloadActive, restoreSession,
    renderRecents, renderTabBar, showWelcome, rerender, goHistory,
    active: activeTab, onFileChanged
  };
})();
