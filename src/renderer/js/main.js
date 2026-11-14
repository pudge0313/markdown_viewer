'use strict';
/* 渲染进程入口：菜单命令、快捷键、拖放、缩放、启动流程 */
(function () {
  const MDV = window.MDV;
  const { $, $$, el, baseName, saveJSON, loadJSON } = MDV;
  const state = MDV.state;

  let booted = false;
  let pendingOpen = null;

  /* ---------------- 打开 ---------------- */
  async function openFileDialog() {
    const p = await window.mdv.openFileDialog();
    if (p) MDV.tabs.openPath(p);
  }

  async function openFolder() {
    const dir = await window.mdv.openFolderDialog();
    if (!dir) return;
    state.root = dir;
    state.expanded.clear();
    saveJSON('mdv.expanded', []);
    MDV.sidebar.setOpen(true);
    MDV.sidebar.setMode('files');
    await MDV.sidebar.refresh();
    MDV.toast('已打开文件夹：' + baseName(dir));
  }

  /* ---------------- 缩放 ---------------- */
  function zoom(cmd) {
    let z = state.zoom;
    if (cmd === 'in') z = Math.min(2.4, +(z + 0.1).toFixed(2));
    else if (cmd === 'out') z = Math.max(0.5, +(z - 0.1).toFixed(2));
    else z = 1;
    if (z === state.zoom) return;
    state.zoom = z;
    saveJSON('mdv.zoom', z);
    window.mdv.setZoom(z);
    showZoomBadge();
  }

  let badgeTimer = null;
  function showZoomBadge() {
    let b = $('#zoom-badge');
    if (!b) {
      b = el('div');
      b.id = 'zoom-badge';
      document.body.appendChild(b);
    }
    b.textContent = Math.round(state.zoom * 100) + '%';
    b.classList.add('show');
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => b.classList.remove('show'), 900);
  }

  /* ---------------- 导出 / 打印 ---------------- */
  async function exportPdf() {
    const tab = MDV.tabs.active();
    const res = await window.mdv.exportPdf(tab ? tab.name : 'document');
    if (res && res.ok) MDV.toast('已导出：' + res.path);
    else if (res && !res.canceled) MDV.toast('导出失败：' + (res.message || '未知错误'));
  }

  /* ---------------- 菜单命令分发 ---------------- */
  const commands = {
    'open': openFileDialog,
    'open-folder': openFolder,
    'new-window': () => {
      const tab = MDV.tabs.active();
      if (tab) window.mdv.openInNewWindow(tab.path);
      else MDV.toast('先打开一个文档');
    },
    'close-tab': () => MDV.tabs.closeActive(),
    'export-pdf': exportPdf,
    'print': () => window.mdv.printPage(),
    'reveal': () => {
      const tab = MDV.tabs.active();
      if (tab) window.mdv.showInFolder(tab.path);
    },
    'default-app': () => window.mdv.openExternal('ms-settings:defaultapps?x=1'),
    'find': () => MDV.find.open(),
    'toggle-sidebar': () => MDV.sidebar.toggle('files'),
    'toggle-outline': () => {
      if (state.sidebar.open && state.sidebar.mode === 'outline') MDV.sidebar.setOpen(false);
      else { MDV.sidebar.setOpen(true); MDV.sidebar.setMode('outline'); }
    },
    'next-tab': () => MDV.tabs.cycle(1),
    'prev-tab': () => MDV.tabs.cycle(-1),
    'nav-back': () => MDV.tabs.goHistory(-1),
    'nav-forward': () => MDV.tabs.goHistory(1),
    'zoom-in': () => zoom('in'),
    'zoom-out': () => zoom('out'),
    'zoom-reset': () => zoom('reset'),
    'save': () => MDV.editor && MDV.editor.saveActive(),
    'mode-edit': () => MDV.editor && MDV.editor.applyMode('edit'),
    'mode-split': () => MDV.editor && MDV.editor.applyMode('split'),
    'mode-preview': () => MDV.editor && MDV.editor.applyMode('preview'),
    'settings': () => MDV.settings.openPanel(),
    'toggle-theme': () => MDV.settings.toggleTheme(),
    'keys': () => MDV.settings.showKeys(),
    'about': () => MDV.settings.showAbout()
  };

  window.mdv.onMenu((cmd) => {
    const fn = commands[cmd];
    if (fn) fn();
  });

  /* ---------------- 快捷键（菜单里 registerAccelerator:false 的部分） ---------------- */
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); MDV.find.open(); return; }
    if (ctrl && e.key.toLowerCase() === 'w') { e.preventDefault(); MDV.tabs.closeActive(); return; }
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openFolder(); return; }
    if (ctrl && e.key === 'Tab') { e.preventDefault(); MDV.tabs.cycle(e.shiftKey ? -1 : 1); return; }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); MDV.tabs.goHistory(-1); return; }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); MDV.tabs.goHistory(1); return; }
    if (e.key === 'F1') { e.preventDefault(); MDV.settings.showKeys(); return; }
    if (e.key === 'Escape') {
      if (!$('#settings-panel').hidden) { MDV.settings.closePanel(); return; }
      if (MDV.find.openState) { MDV.find.close(); return; }
    }
    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (MDV.editor) MDV.editor.saveActive();
      return;
    }
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      if (MDV.editor) MDV.editor.cycleMode();
      return;
    }
    // 侧栏的 Ctrl+B 交给渲染进程判断：编辑区里应该是「加粗」
    if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      MDV.sidebar.toggle('files');
      return;
    }
  });

  /* ---------------- 工具栏 ---------------- */
  $('#btn-open').addEventListener('click', openFileDialog);
  $('#btn-find').addEventListener('click', () => MDV.find.open());
  $('#btn-sidebar').addEventListener('click', () => MDV.sidebar.toggle('files'));
  $('#theme-toggle').addEventListener('click', () => MDV.settings.toggleTheme());
  $('#wl-open').addEventListener('click', openFileDialog);
  $('#wl-open-folder').addEventListener('click', openFolder);

  $$('.side-tab').forEach((b) => b.addEventListener('click', () => MDV.sidebar.setMode(b.dataset.mode)));

  /* 更多菜单 */
  let moreMenu = null;
  function closeMore() {
    if (moreMenu) { moreMenu.remove(); moreMenu = null; }
  }
  $('#btn-more').addEventListener('click', (e) => {
    e.stopPropagation();
    if (moreMenu) { closeMore(); return; }

    moreMenu = el('div');
    moreMenu.id = 'more-menu';
    moreMenu.innerHTML = `
      <button data-act="open">打开文件…<kbd>Ctrl O</kbd></button>
      <button data-act="open-folder">打开文件夹…<kbd>Ctrl K</kbd></button>
      <div class="sep"></div>
      <button data-act="export-pdf">导出 PDF…</button>
      <button data-act="print">打印…<kbd>Ctrl P</kbd></button>
      <button data-act="reveal">在资源管理器中显示</button>
      <div class="sep"></div>
      <button data-act="new-window">在新窗口打开</button>
      <button data-act="default-app">设为默认 .md 打开程序…</button>
      <div class="sep"></div>
      <button data-act="settings">阅读设置…</button>
      <button data-act="keys">快捷键<kbd>F1</kbd></button>
      <button data-act="about">关于</button>`;
    document.body.appendChild(moreMenu);
    const r = $('#btn-more').getBoundingClientRect();
    moreMenu.style.top = (r.bottom + 4) + 'px';
    moreMenu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';

    moreMenu.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      closeMore();
      const fn = commands[b.dataset.act];
      if (fn) fn();
    });
    setTimeout(() => document.addEventListener('click', closeMore, { once: true }), 0);
  });

  /* ---------------- Ctrl + 滚轮缩放 ---------------- */
  $('#content').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 'in' : 'out');
  }, { passive: false });

  /* ---------------- 拖放 ---------------- */
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
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');

    const files = Array.from(e.dataTransfer && e.dataTransfer.files || []);
    if (!files.length) return;

    for (const f of files) {
      let p = '';
      try { p = window.mdv.pathForFile(f) || f.path || ''; } catch { p = f.path || ''; }
      if (!p) continue;
      if (!/\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(p)) {
        // 可能是文件夹 → 当作工作区打开
        const probe = await window.mdv.listDir(p);
        if (probe && probe.ok) {
          state.root = p;
          state.expanded.clear();
          MDV.sidebar.setOpen(true);
          MDV.sidebar.setMode('files');
          await MDV.sidebar.refresh();
          MDV.toast('已打开文件夹：' + baseName(p));
        } else {
          MDV.toast('只支持 .md / .mdx / .txt 文件或文件夹');
        }
        continue;
      }
      await MDV.tabs.openPath(p);
    }
  });

  /* ---------------- 主进程投递的打开请求 ---------------- */
  window.mdv.onOpenFile((p) => {
    if (!booted) { pendingOpen = p; return; }
    MDV.tabs.openPath(p);
  });

  /* ---------------- 启动 ---------------- */
  MDV.app = { openFolder, openFileDialog, zoom, exportPdf };

  (async function boot() {
    MDV.settings.applyPrefs();
    state.lastRenderedTheme = MDV.settings.resolved(state.theme);
    MDV.settings.applyTheme(state.theme);
    window.mdv.setZoom(state.zoom);
    MDV.tabs.renderRecents();

    let restored = false;
    try { restored = await MDV.tabs.restoreSession(); } catch { restored = false; }
    if (!restored) MDV.tabs.showWelcome();

    booted = true;
    if (pendingOpen) {
      const p = pendingOpen;
      pendingOpen = null;
      MDV.tabs.openPath(p);
    }
  })();
})();
