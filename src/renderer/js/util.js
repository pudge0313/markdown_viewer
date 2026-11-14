'use strict';
/* 公共工具与全局状态 —— 必须最先加载 */
(function () {
  const MDV = window.MDV = window.MDV || {};

  /* ---------------- DOM ---------------- */
  MDV.$ = (sel, root) => (root || document).querySelector(sel);
  MDV.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  MDV.el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---------------- 存储 ---------------- */
  MDV.loadJSON = (key, dft) => {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? dft : v;
    } catch { return dft; }
  };
  MDV.saveJSON = (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 配额满时忽略 */ }
  };

  /* ---------------- 路径（Windows 语义，由主进程同一实现提供） ---------------- */
  const isAbs = (p) => /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\/.test(p);
  MDV.isAbs = isAbs;

  MDV.normalizeWinPath = (p) => window.mdv.normalizePath(p);
  MDV.joinAndNormalize = (dir, rel) => window.mdv.joinPath(dir, rel);

  MDV.baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  MDV.dirname = (p) => {
    const s = String(p || '');
    const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i > 0 ? s.slice(0, i) : s;
  };

  /** 本地路径 → file:// URL */
  MDV.fileURL = (p) => {
    let u = String(p).replace(/\\/g, '/');
    try { u = encodeURI(u).replace(/#/g, '%23').replace(/\?/g, '%3F'); } catch { /* ignore */ }
    return 'file:///' + u.replace(/^\/+/, '');
  };

  /* ---------------- 节流 / 防抖 ---------------- */
  MDV.debounce = (fn, wait) => {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  };
  MDV.throttleRAF = (fn) => {
    let queued = false;
    return (...args) => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(...args); });
    };
  };

  /* ---------------- 提示条 ---------------- */
  let toastTimer = null;
  MDV.toast = (msg, kind) => {
    let box = document.getElementById('mdv-toast');
    if (!box) {
      box = MDV.el('div');
      box.id = 'mdv-toast';
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.className = 'show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.className = ''; }, 2600);
  };

  /* ---------------- 确认对话框 ---------------- */
  /**
   * 可测试的页内确认框（比 window.confirm 可控，且跟随主题）。
   * MDV.confirm({ title, message, buttons:[{label,value,primary,danger}] }) -> Promise<value|null>
   */
  MDV.confirm = (opts) => new Promise((resolve) => {
    const o = Object.assign({
      title: '提示',
      message: '',
      buttons: [{ label: '确定', value: true, primary: true }]
    }, opts || {});

    const dlg = document.createElement('dialog');
    dlg.className = 'mdv-confirm';

    const h = document.createElement('h3');
    h.textContent = o.title;

    const msg = document.createElement('p');
    msg.className = 'mc-msg';
    msg.textContent = o.message;

    const row = document.createElement('div');
    row.className = 'mc-actions';

    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { dlg.close(); } catch { /* ignore */ }
      dlg.remove();
      resolve(v);
    };

    for (const b of o.buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      btn.className = b.danger ? 'mc-danger' : (b.primary ? 'mc-primary' : '');
      btn.addEventListener('click', () => finish(b.value));
      row.appendChild(btn);
    }

    dlg.append(h, msg, row);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    document.body.appendChild(dlg);
    dlg.showModal();

    const focus = row.querySelector('.mc-primary') || row.lastElementChild;
    if (focus) focus.focus();
  });

  MDV.formatBytes = (n) => {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  };

  MDV.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------------- 全局状态 ---------------- */
  MDV.state = {
    tabs: [],            // { key, path, name, html, meta, scrollTop, history, pos, missing }
    activeKey: null,
    root: null,          // 工作区根目录
    sidebar: {
      open: false,
      mode: 'files'      // files | outline
    },
    find: { open: false, query: '', hits: [], index: -1 },
    mode: MDV.loadJSON('mdv.mode', 'preview'),   // preview | split | edit
    zoom: MDV.loadJSON('mdv.zoom', 1),
    theme: MDV.loadJSON('mdv.theme', 'dark'),
    prefs: Object.assign({
      fontSize: 14,
      lineHeight: 1.7,
      maxWidth: 0,       // 0 = 不限
      family: 'sans',    // sans | serif | mono
      breaks: true,
      math: true,
      mermaid: true,
      highlight: true
    }, MDV.loadJSON('mdv.prefs', {})),
    recents: MDV.loadJSON('mdv.recents', []),
    expanded: new Set(MDV.loadJSON('mdv.expanded', [])),
    highlightLarge: false
  };
})();
