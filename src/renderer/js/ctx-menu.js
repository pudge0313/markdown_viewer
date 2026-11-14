'use strict';
/* 编辑区右键菜单：常用编辑、格式插入、复制粘贴、保存 */
(function () {
  const MDV = window.MDV;
  const { $, el } = MDV;
  const E = window.MDVEdit;

  const ta = $('#editor-input');
  let menu = null;
  let openedAt = 0;

  const run = (fn) => () => { fn(); };
  const exec = (cmd) => () => { try { document.execCommand(cmd); } catch { /* ignore */ } };

  async function paste() {
    let text = '';
    try { text = await window.mdv.readText(); } catch { text = ''; }
    if (text) MDV.editor.insertAtCursor(text.replace(/\r\n/g, '\n'));
    else document.execCommand('paste');
  }

  /* 每个条目：{ label, key, run }；字符串表示分组标题 */
  const SECTIONS = [
    [
      { label: '撤销', key: 'Ctrl Z', run: exec('undo') },
      { label: '重做', key: 'Ctrl Y', run: exec('redo') }
    ],
    [
      { label: '剪切', key: 'Ctrl X', run: exec('cut') },
      { label: '复制', key: 'Ctrl C', run: exec('copy') },
      { label: '粘贴', key: 'Ctrl V', run: paste },
      { label: '全选', key: 'Ctrl A', run: () => ta.select() }
    ],
    '格式',
    [
      { label: '加粗', key: 'Ctrl B', run: () => MDV.editor.transform(E.bold) },
      { label: '斜体', key: 'Ctrl I', run: () => MDV.editor.transform(E.italic) },
      { label: '删除线', run: () => MDV.editor.transform(E.strike) },
      { label: '行内代码', key: 'Ctrl `', run: () => MDV.editor.transform(E.codeInline) },
      { label: '链接', key: 'Ctrl K', run: () => MDV.editor.transform(E.link) },
      { label: '图片', run: () => MDV.editor.transform(E.image) }
    ],
    '段落',
    [
      { label: '一级标题', key: 'Ctrl 1', run: () => MDV.editor.transform((t, s, e) => E.heading(t, s, e, 1)) },
      { label: '二级标题', key: 'Ctrl 2', run: () => MDV.editor.transform((t, s, e) => E.heading(t, s, e, 2)) },
      { label: '三级标题', key: 'Ctrl 3', run: () => MDV.editor.transform((t, s, e) => E.heading(t, s, e, 3)) },
      { label: '引用', run: () => MDV.editor.transform((t, s, e) => E.toggleLinePrefix(t, s, e, '> ')) },
      { label: '无序列表', run: () => MDV.editor.transform((t, s, e) => E.toggleLinePrefix(t, s, e, '- ')) },
      { label: '有序列表', run: () => MDV.editor.transform((t, s, e) => E.toggleLinePrefix(t, s, e, '1. ', { ordered: true })) },
      { label: '任务列表', run: () => MDV.editor.transform((t, s, e) => E.toggleLinePrefix(t, s, e, '- [ ] ')) },
      { label: '代码块', key: 'Ctrl Shift K', run: () => MDV.editor.transform(E.codeBlock) },
      { label: '表格 3×2', run: () => MDV.editor.transform((t, s, e) => E.table(t, s, e, 3, 2)) },
      { label: '分隔线', run: () => MDV.editor.transform(E.hr) }
    ],
    '插入',
    [
      { label: '当前日期时间', run: () => MDV.editor.insertAtCursor(E.stamp()) },
      { label: '公式块', run: () => MDV.editor.transform(E.mathBlock) }
    ],
    [
      { label: '保存', key: 'Ctrl S', run: () => MDV.editor.saveActive() }
    ]
  ];

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', onScroll, true);
  }

  function onDocDown(e) {
    if (menu && !menu.contains(e.target)) close();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function build() {
    const box = el('div');
    box.id = 'ctx-menu';
    box.setAttribute('role', 'menu');

    for (const group of SECTIONS) {
      if (typeof group === 'string') {
        box.appendChild(el('div', 'cm-title', group));
        continue;
      }
      for (const item of group) {
        const b = el('button', 'cm-item');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');

        const label = el('span', 'cm-label', item.label);
        b.appendChild(label);
        if (item.key) {
          const k = el('kbd', '', item.key);
          b.appendChild(k);
        }

        b.addEventListener('click', () => {
          close();
          try { item.run(); } catch (err) { MDV.toast('操作失败：' + (err && err.message), 'warn'); }
          setTimeout(() => ta.focus(), 0);
        });
        box.appendChild(b);
      }
      box.appendChild(el('div', 'cm-sep'));
    }

    if (box.lastChild && box.lastChild.classList.contains('cm-sep')) box.removeChild(box.lastChild);
    return box;
  }

  function open(x, y) {
    close();
    menu = build();
    document.body.appendChild(menu);

    // 先测量再定位，避免超出窗口
    const r = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - r.width - 8);
    const top = Math.min(y, window.innerHeight - r.height - 8);
    menu.style.left = Math.max(6, left) + 'px';
    menu.style.top = Math.max(6, top) + 'px';

    openedAt = Date.now();
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', onScroll, true);
  }

  /** 刚打开时的滚动多半是编辑器自动把光标滚入视野，不该把菜单关掉 */
  function onScroll() {
    if (Date.now() - openedAt < 250) return;
    close();
  }

  ta.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    open(e.clientX, e.clientY);
  });

  MDV.ctxMenu = { open, close, get openState() { return !!menu; } };
})();
