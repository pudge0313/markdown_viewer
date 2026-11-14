'use strict';
/* 阅读设置 / 主题 / 关于 / 快捷键 */
(function () {
  const MDV = window.MDV;
  const { $, $$, saveJSON } = MDV;
  const state = MDV.state;

  const panel = $('#settings-panel');
  const scrim = $('#settings-scrim');

  const mq = window.matchMedia('(prefers-color-scheme: dark)');

  /* ---------------- 主题 ---------------- */
  function resolved(t) {
    if (t === 'system') return mq.matches ? 'dark' : 'light';
    return t === 'light' ? 'light' : 'dark';
  }

  function applyTheme(t) {
    state.theme = ['dark', 'light', 'system'].includes(t) ? t : 'dark';
    saveJSON('mdv.theme', state.theme);
    const r = resolved(state.theme);
    document.body.classList.toggle('light', r === 'light');
    window.mdv.persistTheme(state.theme);
    const sel = $('#set-theme');
    if (sel) sel.value = state.theme;
    // mermaid 已渲染的图需要换主题重画
    if (r !== state.lastRenderedTheme) {
      state.lastRenderedTheme = r;
      $$('.mermaid-block').forEach((b) => { b.dataset.rendered = '0'; b.innerHTML = '<div class="mermaid-status">图表渲染中…</div>'; });
      if (MDV.view) MDV.view.renderMermaids($('#view'));
    }
  }

  function toggleTheme() {
    applyTheme(resolved(state.theme) === 'light' ? 'dark' : 'light');
  }

  mq.addEventListener('change', () => { if (state.theme === 'system') applyTheme('system'); });

  /* ---------------- 阅读偏好 ---------------- */
  const FAMILIES = {
    sans: '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
    serif: 'Georgia, "Songti SC", "SimSun", "Noto Serif SC", serif',
    mono: '"Cascadia Mono", "Consolas", "Sarasa Mono SC", monospace'
  };

  function applyPrefs() {
    const p = state.prefs;
    const root = document.documentElement;
    root.style.setProperty('--md-font-size', p.fontSize + 'px');
    root.style.setProperty('--md-line-height', String(p.lineHeight));
    root.style.setProperty('--md-max-width', p.maxWidth > 0 ? p.maxWidth + 'px' : 'none');
    root.style.setProperty('--md-font-family', FAMILIES[p.family] || FAMILIES.sans);
    saveJSON('mdv.prefs', p);

    const bind = {
      'set-font-size': p.fontSize,
      'set-line-height': p.lineHeight,
      'set-max-width': String(p.maxWidth),
      'set-family': p.family,
      'set-breaks': p.breaks,
      'set-math': p.math,
      'set-mermaid': p.mermaid,
      'set-highlight': p.highlight
    };
    for (const [id, val] of Object.entries(bind)) {
      const node = document.getElementById(id);
      if (!node) continue;
      if (node.type === 'checkbox') node.checked = !!val;
      else node.value = String(val);
    }
    const fsOut = $('#set-font-size-out');
    if (fsOut) fsOut.textContent = p.fontSize + 'px';
    const lhOut = $('#set-line-height-out');
    if (lhOut) lhOut.textContent = Number(p.lineHeight).toFixed(2);
  }

  function wirePrefs() {
    const on = (id, evt, fn) => { const n = document.getElementById(id); if (n) n.addEventListener(evt, fn); };

    on('set-font-size', 'input', (e) => {
      state.prefs.fontSize = Number(e.target.value);
      applyPrefs();
    });
    on('set-line-height', 'input', (e) => {
      state.prefs.lineHeight = Number(e.target.value);
      applyPrefs();
    });
    on('set-max-width', 'change', (e) => {
      state.prefs.maxWidth = Number(e.target.value);
      applyPrefs();
    });
    on('set-family', 'change', (e) => {
      state.prefs.family = e.target.value;
      applyPrefs();
    });
    on('set-breaks', 'change', (e) => {
      state.prefs.breaks = e.target.checked;
      applyPrefs();
      MDV.tabs.rerender('已切换换行策略');
    });
    on('set-math', 'change', (e) => {
      state.prefs.math = e.target.checked;
      applyPrefs();
      MDV.tabs.rerender('已切换公式渲染');
    });
    on('set-mermaid', 'change', (e) => {
      state.prefs.mermaid = e.target.checked;
      applyPrefs();
      MDV.tabs.rerender('已切换图表渲染');
    });
    on('set-highlight', 'change', (e) => {
      state.prefs.highlight = e.target.checked;
      applyPrefs();
      MDV.tabs.rerender('已切换语法高亮');
    });
    on('set-theme', 'change', (e) => applyTheme(e.target.value));

    const reset = $('#set-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        state.prefs = {
          fontSize: 14, lineHeight: 1.7, maxWidth: 0, family: 'sans',
          breaks: true, math: true, mermaid: true, highlight: true
        };
        applyPrefs();
        MDV.tabs.rerender('已恢复默认阅读设置');
      });
    }

    const wide = $('#set-wide');
    if (wide) {
      wide.addEventListener('click', () => {
        state.prefs.maxWidth = state.prefs.maxWidth > 0 ? 0 : 860;
        applyPrefs();
      });
    }
  }

  /* ---------------- 面板开关 ---------------- */
  function openPanel() {
    panel.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => panel.classList.add('in'));
  }
  function closePanel() {
    panel.classList.remove('in');
    scrim.hidden = true;
    setTimeout(() => { panel.hidden = true; }, 160);
  }
  const togglePanel = () => (panel.hidden ? openPanel() : closePanel());

  scrim.addEventListener('click', closePanel);
  $('#btn-settings').addEventListener('click', togglePanel);
  $('#settings-close').addEventListener('click', closePanel);

  /* ---------------- 关于 ---------------- */
  async function showAbout() {
    const dlg = $('#about-dlg');
    try {
      const info = await window.mdv.appInfo();
      $('#about-version').textContent = '版本 ' + info.version;
      $('#about-env').textContent = `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`;
    } catch { /* 取不到就不显示环境信息 */ }
    dlg.showModal();
  }

  function showKeys() { $('#keys-dlg').showModal(); }

  wirePrefs();

  MDV.settings = { applyPrefs, applyTheme, toggleTheme, resolved, openPanel, closePanel, togglePanel, showAbout, showKeys };
})();
