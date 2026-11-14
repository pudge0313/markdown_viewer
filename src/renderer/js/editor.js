'use strict';
/* 编辑区：编辑 / 分栏 / 预览三态、实时预览、保存与冲突处理、编辑快捷键 */
(function () {
  const MDV = window.MDV;
  const { $, $$, el } = MDV;
  const state = MDV.state;
  const E = window.MDVEdit;

  const pane = $('#editor-pane');
  const ta = $('#editor-input');
  const content = $('#content');
  const statusPos = $('#ed-pos');
  const statusStat = $('#ed-stat');
  const statusState = $('#ed-state');
  const saveBtn = $('#btn-save');

  let previewTimer = null;
  let syncLock = false;
  const mode = () => state.mode || 'preview';
  const currentTab = () => (MDV.tabs ? MDV.tabs.active() : null);

  /* ---------------- 状态栏 ---------------- */
  function updateStatus() {
    const tab = currentTab();
    const text = ta.value || '';
    const info = E.lineInfo(text, ta.selectionStart);
    if (statusPos) statusPos.textContent = `行 ${info.line}，列 ${info.col}`;
    if (statusStat) statusStat.textContent = `${E.countChars(text).toLocaleString()} 字`;
    if (statusState) {
      const dirty = !!(tab && tab.dirty);
      statusState.textContent = !tab ? '—' : (dirty ? '未保存' : '已保存');
      statusState.classList.toggle('dirty', dirty);
    }
    if (saveBtn) saveBtn.disabled = !tab || !tab.dirty;
  }

  /* ---------------- 模式切换 ---------------- */
  /** 只负责把当前状态画到界面上；没有文档时始终显示预览布局（即欢迎页） */
  function applyVisual() {
    const hasTab = !!currentTab();
    const m = mode();
    document.body.dataset.mode = hasTab ? m : 'preview';
    pane.hidden = !hasTab || m === 'preview';
    $$('.mode-btn').forEach((b) => {
      b.classList.toggle('active', hasTab && b.dataset.mode === m);
      b.disabled = !hasTab;   // 没有文档时三档按钮无意义
    });
  }

  function applyMode(next, opts) {
    const m = next === 'edit' || next === 'split' ? next : 'preview';
    state.mode = m;
    MDV.saveJSON('mdv.mode', m);
    applyVisual();

    if (m !== 'preview' && currentTab()) {
      loadFromTab();
      if (!opts || opts.focus !== false) setTimeout(() => ta.focus(), 0);
    }
    updateStatus();
  }

  function cycleMode() {
    const order = ['preview', 'split', 'edit'];
    const i = order.indexOf(mode());
    applyMode(order[(i + 1) % order.length]);
  }

  /* ---------------- 与标签同步 ---------------- */
  function loadFromTab() {
    const tab = currentTab();
    if (!tab) { ta.value = ''; ta.dataset.key = ''; return; }
    if (ta.dataset.key !== tab.key) {
      ta.value = tab.text;
      ta.dataset.key = tab.key;
      ta.scrollTop = 0;
    } else if (ta.value !== tab.text) {
      // 同一标签被外部重载：同步新内容
      ta.value = tab.text;
    }
  }

  function onActivate(tab) {
    const m = mode();
    applyVisual();
    if (!tab) {
      ta.value = '';
      ta.dataset.key = '';
      updateStatus();
      return;
    }
    if (m !== 'preview') loadFromTab();
    updateStatus();
  }

  /** 外部重载（文件被刷新）后同步编辑区 */
  function onReload(tab) {
    if (!tab) return;
    if (tab.key === ta.dataset.key) {
      ta.value = tab.text;
      ta.dataset.key = tab.key;
    }
    updateStatus();
  }

  /* ---------------- 实时预览 ---------------- */
  function schedulePreview() {
    clearTimeout(previewTimer);
    const delay = ta.value.length > 400000 ? 700 : 220;
    previewTimer = setTimeout(renderPreview, delay);
  }

  /** 立即把挂起的预览刷新掉（切标签前调用，避免预览落后于文本） */
  function flushPreview() {
    clearTimeout(previewTimer);
    if (mode() === 'preview') return;
    if (currentTab() && currentTab().dirty) renderPreview();
  }

  function renderPreview() {
    const tab = currentTab();
    if (!tab) return;
    const scroll = MDV.view.currentScroll();
    const rendered = MDV.tabs.renderText(tab.text, { size: tab.text.length });
    tab.html = rendered.html;
    tab.meta = rendered;
    MDV.view.render(tab, { restore: true, scrollTop: scroll });
  }

  /* ---------------- 选区替换（保留撤销栈） ---------------- */
  function replaceRange(from, to, insert, selStart, selEnd) {
    if (from === to && !insert) return;
    ta.focus();
    ta.setSelectionRange(from, to);

    const before = ta.value;
    let ok = false;
    try { ok = document.execCommand('insertText', false, insert); } catch { ok = false; }

    // 窗口未获得焦点时 execCommand 可能静默失败，用直接改值兜底
    if (!ok || ta.value === before) {
      ta.value = before.slice(0, from) + insert + before.slice(to);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    ta.setSelectionRange(selStart, selEnd);
    updateStatus();
  }

  /** 应用一次纯文本变换（右键菜单 / 快捷键共用） */
  function transform(fn) {
    const tab = currentTab();
    if (!tab || mode() === 'preview') return false;
    let r;
    try { r = fn(ta.value, ta.selectionStart, ta.selectionEnd); } catch { return false; }
    if (!r || r.from == null) return false;
    replaceRange(r.from, r.to, r.insert, r.selStart, r.selEnd);
    return true;
  }

  function insertAtCursor(snippet) {
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    replaceRange(s, e, snippet, s + snippet.length, s + snippet.length);
  }

  /* ---------------- 保存 ---------------- */
  async function save(tab, opts) {
    const target = tab || currentTab();
    if (!target) return false;

    const text = target === currentTab() ? ta.value : target.text;
    if (!target.dirty) { MDV.toast('没有需要保存的修改'); return true; }

    if (contextLost(target)) return false;

    let res = await window.mdv.saveFile(target.path, text, target.mtime);
    if (res && res.code === 'conflict' && !(opts && opts.force)) {
      const choice = await MDV.confirm({
        title: '文件已被其他程序修改',
        message: '磁盘上的内容比你打开时更新。覆盖会丢弃外部的改动；取消则保留磁盘内容，你的编辑仍在编辑器里。',
        buttons: [
          { label: '取消', value: 'cancel' },
          { label: '仍要覆盖', value: 'force', danger: true }
        ]
      });
      if (choice !== 'force') return false;
      res = await window.mdv.saveFile(target.path, text, null);
    }

    if (!res || !res.ok) {
      MDV.toast('保存失败：' + ((res && res.message) || '未知错误'), 'warn');
      return false;
    }

    target.text = text;
    target.mtime = res.mtime;
    target.size = res.size;
    target.dirty = false;
    MDV.tabs.renderTabBar();
    updateStatus();
    MDV.toast('已保存');
    return true;
  }

  /** 文件在编辑期间被删除时，不允许静默写入（会凭空创建文件） */
  function contextLost(tab) {
    if (tab.missing) {
      MDV.toast('文件已被移动或删除，无法保存；请用「另存为」另存一份', 'warn');
      return true;
    }
    return false;
  }

  const saveActive = () => save(currentTab());

  /** 保存所有脏标签（关窗时用） */
  async function saveAll() {
    for (const t of state.tabs.slice()) {
      if (!t.dirty) continue;
      const ok = await save(t);
      if (!ok) return false;
    }
    return true;
  }

  /* ---------------- 未保存确认 ---------------- */
  async function confirmClose(tab) {
    if (!tab || !tab.dirty) return true;
    const choice = await MDV.confirm({
      title: '有未保存的修改',
      message: `「${tab.name}」还没保存，关闭会丢失这些修改。`,
      buttons: [
        { label: '取消', value: 'cancel' },
        { label: '不保存', value: 'discard' },
        { label: '保存并关闭', value: 'save', primary: true }
      ]
    });
    if (choice === 'save') return save(tab);
    return choice === 'discard';
  }

  /* ---------------- 输入 ---------------- */
  ta.addEventListener('input', () => {
    const tab = currentTab();
    if (!tab) return;
    tab.text = ta.value;
    if (!tab.dirty) {
      tab.dirty = true;
      MDV.tabs.renderTabBar();
    }
    updateStatus();
    schedulePreview();
  });

  ta.addEventListener('click', updateStatus);
  ta.addEventListener('keyup', updateStatus);
  ta.addEventListener('select', updateStatus);

  ta.addEventListener('scroll', () => {
    if (mode() !== 'split' || syncLock) return;
    const max = ta.scrollHeight - ta.clientHeight;
    const cmax = content.scrollHeight - content.clientHeight;
    if (max <= 0 || cmax <= 0) return;
    syncLock = true;
    content.scrollTop = (ta.scrollTop / max) * cmax;
    requestAnimationFrame(() => { syncLock = false; });
  }, { passive: true });

  content.addEventListener('scroll', () => {
    if (mode() !== 'split' || syncLock) return;
    const max = ta.scrollHeight - ta.clientHeight;
    const cmax = content.scrollHeight - content.clientHeight;
    if (max <= 0 || cmax <= 0) return;
    syncLock = true;
    ta.scrollTop = (content.scrollTop / cmax) * max;
    requestAnimationFrame(() => { syncLock = false; });
  }, { passive: true });

  /* ---------------- 编辑快捷键 ---------------- */
  ta.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // 这些组合键在编辑区要抢在全局快捷键之前处理
    if (ctrl && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); e.stopPropagation(); transform(E.bold); return; }
      if (k === 'i') { e.preventDefault(); e.stopPropagation(); transform(E.italic); return; }
      if (k === 'k') { e.preventDefault(); e.stopPropagation(); transform(E.link); return; }
      if (k === '`') { e.preventDefault(); e.stopPropagation(); transform(E.codeInline); return; }
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) transform(E.outdent);
      else if (ta.selectionStart !== ta.selectionEnd) transform(E.indent);
      else insertAtCursor('  ');
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !ctrl) {
      if (continueList()) e.preventDefault();
    }
  });

  /** 回车自动续写列表 / 标题为空时退出列表 */
  function continueList() {
    const pos = ta.selectionStart;
    if (pos !== ta.selectionEnd) return false;
    const text = ta.value;
    const ls = E.lineStartOf(text, pos);
    const line = text.slice(ls, pos);
    const m = line.match(/^(\s*)([-*+]|\d+\.)(\s+)(\[[ xX]\]\s+)?/);
    if (!m) return false;

    const body = line.slice(m[0].length);
    if (!body.trim()) {
      // 空列表项：再按回车结束列表
      replaceRange(ls, pos, '', ls, ls);
      return true;
    }

    let marker = m[2];
    if (/^\d+\.$/.test(marker)) marker = (parseInt(marker, 10) + 1) + '.';
    const bullet = m[4] ? '- [ ] ' : marker + ' ';
    const insert = '\n' + m[1] + bullet;
    insertAtCursor(insert);
    return true;
  }

  /* ---------------- 事件绑定 ---------------- */
  $$('.mode-btn').forEach((b) => {
    b.addEventListener('click', () => applyMode(b.dataset.mode));
  });
  if (saveBtn) saveBtn.addEventListener('click', () => saveActive());

  MDV.editor = {
    applyMode,
    cycleMode,
    onActivate,
    onReload,
    save,
    saveActive,
    saveAll,
    flushPreview,
    confirmClose,
    transform,
    insertAtCursor,
    updateStatus,
    isEditing: () => mode() !== 'preview' && document.activeElement === ta,
    focus: () => ta.focus(),
    get mode() { return mode(); },
    get textarea() { return ta; }
  };

  // 启动时恢复上次模式（欢迎页没有标签时仍显示欢迎页）
  applyMode(mode(), { focus: false });
})();
