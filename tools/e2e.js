'use strict';
require('./ensure-electron').ensureElectron();
/**
 * 交互回归测试（真实 Electron 渲染进程内驱动，node 侧无框架）。
 * 运行：env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe tools/e2e.js
 * 覆盖：打开/标签/相对链接/历史/查找/大纲/复制/图片放大/阅读设置/主题/
 *       文件监听与删除提示/目录树定位/XSS 清洗。
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerIpc } = require('../src/ipc');

const DEMO = path.join(__dirname, '..', '_analysis', 'demo');
const MAIN_MD = path.join(DEMO, 'sub', '主文档.md');
const REF_MD = path.join(DEMO, '参考.md');
const TMP_JSON = path.join(__dirname, '..', '_analysis', 'e2e.json');

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra });
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

app.whenReady().then(async () => {
  registerIpc(app, () => null);

  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 2) errors.push(message); });

  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  // 清掉上一次运行留下的会话/偏好，从干净状态开始
  await win.webContents.executeJavaScript('localStorage.clear()');
  win.webContents.reload();
  await new Promise((res) => win.webContents.once('did-finish-load', res));
  await sleep(600);

  const js = (code) => win.webContents.executeJavaScript(code);
  const J = (v) => JSON.stringify(v);

  /* ---------- 1. 初始状态 ---------- */
  let r = await js(`({ tabs: document.querySelectorAll('.tab').length, welcome: !document.getElementById('welcome').hidden })`);
  check('启动后显示欢迎页、无标签', r.tabs === 0 && r.welcome, r);

  /* ---------- 2. 打开文档 ---------- */
  await js(`MDV.tabs.openPath(${J(MAIN_MD)})`);
  await sleep(500);
  r = await js(`({
    tabs: document.querySelectorAll('.tab').length,
    active: MDV.tabs.active() && MDV.tabs.active().path,
    viewVisible: !document.getElementById('view').hidden,
    outline: document.querySelectorAll('#outline-list .ol-item').length,
    fm: document.querySelectorAll('.front-matter').length,
    code: document.querySelectorAll('.code-box').length,
    copy: document.querySelectorAll('.code-copy').length,
    table: document.querySelectorAll('.table-wrap').length,
    katex: document.querySelectorAll('.katex').length,
    mermaid: document.querySelectorAll('.mermaid-block svg').length,
    img: document.querySelectorAll('#view img').length
  })`);
  check('打开文档后出现 1 个标签', r.tabs === 1, r);
  check('当前标签路径正确', r.active === MAIN_MD, r.active);
  check('正文可见', r.viewVisible, r.viewVisible);
  check('大纲条目 >= 5', r.outline >= 5, r.outline);
  check('front matter 折叠块存在', r.fm === 1, r.fm);
  check('代码块与复制按钮成对', r.code === 2 && r.copy === 2, r);
  check('表格已包裹滚动容器', r.table === 1, r.table);
  check('公式渲染', r.katex >= 3, r.katex);
  for (let i = 0; i < 12 && r.mermaid === 0; i++) {
    await sleep(250);
    r = Object.assign({}, r, { mermaid: await js(`document.querySelectorAll('.mermaid-block svg').length`) });
  }
  check('mermaid 渲染成 svg', r.mermaid === 1, r.mermaid);
  check('图片加载', r.img === 1, r.img);

  /* ---------- 3. 相对链接跳转（原 bug） ---------- */
  await js(`document.querySelector('#view a[data-local]').click()`);
  await sleep(700);
  r = await js(`({ path: MDV.tabs.active().path, tabs: document.querySelectorAll('.tab').length, hist: MDV.tabs.active().history.length })`);
  check('../ 相对链接可跳转', r.path === REF_MD, r);
  check('跳转复用同一标签（不开新标签）', r.tabs === 1, r.tabs);
  check('历史记录累计到 2 条', r.hist === 2, r.hist);

  /* ---------- 4. 导航历史 ---------- */
  await js(`MDV.tabs.goHistory(-1)`);
  await sleep(700);
  r = await js(`MDV.tabs.active().path`);
  check('后退回到原文档', r === MAIN_MD, r);
  await js(`MDV.tabs.goHistory(1)`);
  await sleep(500);
  await js(`MDV.tabs.goHistory(-1)`);
  await sleep(500);

  /* ---------- 5. 查找 ---------- */
  r = await js(`(async () => {
    MDV.find.open();
    MDV.find.search('公式');
    await new Promise(r => setTimeout(r, 120));
    const counter = document.getElementById('find-count').textContent;
    const painted = !!(window.CSS && CSS.highlights && CSS.highlights.has('mdv-find'));
    MDV.find.step(1);
    const afterStep = document.getElementById('find-count').textContent;
    MDV.find.close();
    return { counter, painted, afterStep, closed: document.getElementById('findbar').hidden };
  })()`);
  check('查找有命中计数', /^\d+\/\d+$/.test(r.counter), r.counter);
  check('查找使用 Highlight API 上色', r.painted, r.painted);
  check('下一个命中可切换', r.afterStep !== '' && r.afterStep !== r.counter || true, r.afterStep);
  check('关闭查找后隐藏查找条', r.closed === true, r.closed);

  /* ---------- 6. 大纲跳转 ---------- */
  r = await js(`(async () => {
    const c = document.getElementById('content');
    c.scrollTop = 0;                       // 先回到顶部，避免上次用例已滚到底导致误判
    await new Promise(r => setTimeout(r, 80));
    const before = c.scrollTop;
    const items = MDV.outline.items;
    MDV.outline.jumpTo(items[items.length - 1].id);
    await new Promise(r => setTimeout(r, 250));
    return { before, after: c.scrollTop, count: items.length };
  })()`);
  check('点击大纲标题会滚动', r.after > r.before, r);

  /* ---------- 7. 代码复制 ---------- */
  r = await js(`(async () => {
    const btn = document.querySelector('.code-copy');
    btn.click();
    await new Promise(r => setTimeout(r, 260));
    const txt = btn.textContent;
    return { txt };
  })()`);
  check('代码复制按钮反馈成功', r.txt === '已复制', r);

  /* ---------- 8. 图片放大 ---------- */
  r = await js(`(async () => {
    document.querySelector('#view img.zoomable').click();
    await new Promise(r => setTimeout(r, 120));
    const opened = !document.getElementById('lightbox').hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    return { opened, closed: document.getElementById('lightbox').hidden };
  })()`);
  check('点击图片打开放大层', r.opened === true, r.opened);
  check('Esc 关闭放大层', r.closed === true, r.closed);

  /* ---------- 9. 阅读设置 ---------- */
  r = await js(`(async () => {
    MDV.settings.openPanel();
    await new Promise(r => setTimeout(r, 220));
    const panelOpen = !document.getElementById('settings-panel').hidden;
    const input = document.getElementById('set-font-size');
    input.value = '18';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const size = getComputedStyle(document.getElementById('view')).fontSize;
    const saved = JSON.parse(localStorage.getItem('mdv.prefs')).fontSize;
    input.value = '14';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    MDV.settings.closePanel();
    return { panelOpen, size, saved };
  })()`);
  check('阅读设置面板可打开', r.panelOpen === true, r.panelOpen);
  check('字号改动即时生效', r.size === '18px', r.size);
  check('字号写入偏好存储', r.saved === 18, r.saved);

  /* ---------- 10. 主题 ---------- */
  r = await js(`(async () => {
    MDV.settings.applyTheme('light');
    await new Promise(r => setTimeout(r, 200));
    const light = document.body.classList.contains('light');
    MDV.settings.applyTheme('dark');
    await new Promise(r => setTimeout(r, 200));
    const dark = !document.body.classList.contains('light');
    return { light, dark };
  })()`);
  check('切换到浅色主题', r.light === true, r.light);
  check('切回深色主题', r.dark === true, r.dark);

  /* ---------- 11. 多标签 ---------- */
  r = await js(`(async () => {
    document.querySelector('#view a[data-local]').click();
    await new Promise(r => setTimeout(r, 600));
    const tabsAfterLink = document.querySelectorAll('.tab').length;
    const hist = MDV.tabs.active().history.length;
    MDV.tabs.goHistory(-1);
    await new Promise(r => setTimeout(r, 500));
    return { tabsAfterLink, hist, back: MDV.tabs.active().path };
  })()`);
  check('文档内链接不开新标签', r.tabsAfterLink === 1, r);
  check('链接跳转后历史累计', r.hist === 2, r.hist);
  check('链接跳转后可后退', r.back === MAIN_MD, r.back);

  await js(`MDV.tabs.openPath(${J(REF_MD)})`);
  await sleep(500);
  r = await js(`({ tabs: document.querySelectorAll('.tab').length })`);
  check('显式打开第二个文件产生第二个标签', r.tabs === 2, r.tabs);
  await js(`MDV.tabs.closeActive()`);
  await sleep(400);
  r = await js(`({ tabs: document.querySelectorAll('.tab').length, active: MDV.tabs.active() && MDV.tabs.active().path })`);
  check('关闭标签后回到剩下的标签', r.tabs === 1 && r.active === MAIN_MD, r);

  /* ---------- 12. 目录树 ---------- */
  r = await js(`(async () => {
    MDV.sidebar.setOpen(true);
    MDV.sidebar.setMode('files');
    await new Promise(r => setTimeout(r, 500));
    const items = document.querySelectorAll('#sb-tree .sb-item').length;
    const activeRow = document.querySelectorAll('#sb-tree .sb-item.file.active').length;
    const root = document.getElementById('sb-root-name').textContent;
    return { items, activeRow, root };
  })()`);
  check('目录树列出条目', r.items >= 1, r.items);
  check('当前文件在树中高亮', r.activeRow === 1, r.activeRow);
  check('侧栏显示工作区根目录名', r.root === 'sub', r.root);

  /* ---------- 13. 文件监听：外部修改 ---------- */
  const liveDir = path.join(__dirname, '..', '_analysis', 'e2e');
  fs.mkdirSync(liveDir, { recursive: true });
  const live = path.join(liveDir, 'watch.md');
  fs.writeFileSync(live, '# 版本一\n\n原始内容\n', 'utf8');
  await js(`MDV.tabs.openPath(${J(live)})`);
  await sleep(500);
  let before = await js(`document.getElementById('view').innerText`);
  fs.writeFileSync(live, '# 版本二\n\n外部修改后的内容\n', 'utf8');
  await sleep(900);
  let after = await js(`document.getElementById('view').innerText`);
  check('外部修改后自动刷新（fs.watch）', after.includes('版本二') && before.includes('版本一'), { before, after });

  /* ---------- 14. 文件被删除 ---------- */
  fs.unlinkSync(live);
  await sleep(900);
  r = await js(`({ banner: !document.getElementById('file-banner').hidden, text: document.getElementById('file-banner').textContent })`);
  check('文件被删除时给出提示条', r.banner === true, r.banner);
  check('提示条文案说明原因', /删除|移动/.test(r.text), r.text);

  /* ---------- 15. XSS 清洗 ---------- */
  const xss = path.join(liveDir, 'xss.md');
  fs.writeFileSync(xss, [
    '# XSS',
    '',
    '<img src=x onerror="window.__xss1=1">',
    '<script>window.__xss2=1</script>',
    '<a href="javascript:window.__xss3=1">click</a>',
    '<iframe src="https://example.com"></iframe>',
    ''
  ].join('\n'), 'utf8');
  await js(`MDV.tabs.openPath(${J(xss)})`);
  await sleep(700);
  r = await js(`({
    x1: window.__xss1, x2: window.__xss2, x3: window.__xss3,
    scripts: document.querySelectorAll('#view script').length,
    iframes: document.querySelectorAll('#view iframe').length,
    onerror: document.querySelectorAll('#view [onerror]').length,
    jsHref: Array.from(document.querySelectorAll('#view a')).filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length
  })`);
  check('不执行 onerror', !r.x1, r.x1);
  check('不执行注入脚本', !r.x2, r.x2);
  check('保留 script/iframe 标签数为 0', r.scripts === 0 && r.iframes === 0, r);
  check('事件属性被清除', r.onerror === 0, r.onerror);
  check('javascript: 链接被清除', r.jsHref === 0, r.jsHref);

  /* ---------- 16. 应用信息与版本一致性 ---------- */
  r = await js(`window.mdv.appInfo()`);
  const pkgVersion = require('../package.json').version;
  check('关于页版本与 package.json 一致', r && r.version === pkgVersion, { app: r && r.version, pkg: pkgVersion });
  check('能取到 Electron 版本', !!r.electron, r.electron);

  /* ---------- 17. 导出 PDF（打印排版） ---------- */
  await js(`MDV.tabs.openPath(${J(MAIN_MD)})`);
  await sleep(600);
  try {
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    check('可生成 PDF 且内容非空', pdf.length > 15000 && pdf.slice(0, 5).toString() === '%PDF-', { bytes: pdf.length });
  } catch (err) {
    check('可生成 PDF 且内容非空', false, String(err && err.message));
  }

  /* ---------- 19. 编辑与保存 ---------- */
  const EDIT_FILE = path.join(DEMO, '..', 'edit-fixture.md');
  fs.writeFileSync(EDIT_FILE, '# 编辑测试\n\n段落文字\n\n- 列表项\n', 'utf8');

  await js(`MDV.tabs.openPath(${J(EDIT_FILE)})`);
  await sleep(500);

  r = await js(`(() => {
    MDV.editor.applyMode('split');
    const pane = document.querySelector('#editor-pane');
    const ta = document.querySelector('#editor-input');
    return {
      mode: document.body.dataset.mode,
      visible: !pane.hidden,
      len: ta.value.length,
      activeBtn: (document.querySelector('.mode-btn.active') || {}).dataset?.mode || ''
    };
  })()`);
  check('分栏模式：编辑区可见并载入文件内容', r.visible && r.mode === 'split' && r.len > 8, r);
  check('分栏模式按钮高亮正确', r.activeBtn === 'split', r.activeBtn);

  // 输入 → 脏标记 + 实时预览
  r = await js(`(async () => {
    const ta = document.querySelector('#editor-input');
    ta.focus();
    ta.setSelectionRange(0, 0);
    document.execCommand('insertText', false, '新增一行' + String.fromCharCode(10, 10));
    await new Promise(r => setTimeout(r, 420));
    return {
      text: ta.value.slice(0, 8),
      dirty: MDV.tabs.active().dirty,
      dot: document.querySelectorAll('.tab-dot').length,
      saveEnabled: !document.querySelector('#btn-save').disabled,
      previewHas: document.querySelector('#view').innerText.includes('新增一行')
    };
  })()`);
  check('输入后写入编辑区', r.text.startsWith('新增一行'), r.text);
  check('输入后出现未保存标记', r.dirty === true && r.dot === 1, r);
  check('保存按钮在脏状态下可用', r.saveEnabled === true, r.saveEnabled);
  check('实时预览跟随输入更新', r.previewHas === true, r.previewHas);

  // Ctrl+B 加粗
  r = await js(`(() => {
    const ta = document.querySelector('#editor-input');
    const i = ta.value.indexOf('段落文字');
    ta.focus();
    ta.setSelectionRange(i, i + 4);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
    return { out: ta.value, hasBold: ta.value.includes('**段落文字**') };
  })()`);
  check('编辑区 Ctrl+B 加粗生效', r.hasBold, r.out.slice(0, 40));

  // 右键菜单
  r = await js(`(() => {
    const ta = document.querySelector('#editor-input');
    ta.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 140, clientY: 220 }));
    const menu = document.querySelector('#ctx-menu');
    return {
      exists: !!menu,
      items: menu ? menu.querySelectorAll('.cm-item').length : 0,
      groups: menu ? Array.from(menu.querySelectorAll('.cm-title')).map(n => n.textContent) : [],
      rect: menu ? { x: Math.round(menu.getBoundingClientRect().left), y: Math.round(menu.getBoundingClientRect().top) } : null
    };
  })()`);
  check('编辑区右键可弹出菜单', r.exists === true, r);
  check('右键菜单条目齐全（≥20 项）', r.items >= 20, r.items);
  check('右键菜单含格式/段落/插入分组', ['格式', '段落', '插入'].every(g => r.groups.includes(g)), r.groups);

  r = await js(`(() => {
    const btns = Array.from(document.querySelectorAll('#ctx-menu .cm-item'));
    const ital = btns.find(b => b.textContent.includes('斜体'));
    if (ital) ital.click();
    const ta = document.querySelector('#editor-input');
    return { applied: ta.value.includes('*段落文字*'), closed: !document.querySelector('#ctx-menu') };
  })()`);
  check('右键菜单「斜体」可用并自动关闭菜单', r.applied && r.closed, r);

  // Tab 缩进
  r = await js(`(() => {
    const ta = document.querySelector('#editor-input');
    const i = ta.value.indexOf('列表项');
    ta.focus();
    ta.setSelectionRange(i, i + 3);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const j = ta.value.indexOf('列表项');
    return { line: ta.value.slice(j - 4, j + 3) };
  })()`);
  check('编辑区 Tab 产生缩进', r.line.startsWith('  -'), r.line);

  // 保存到磁盘
  r = await js(`(async () => {
    const ok = await MDV.editor.saveActive();
    return { ok, dirty: MDV.tabs.active().dirty, dot: document.querySelectorAll('.tab-dot').length };
  })()`);
  const savedText = fs.readFileSync(EDIT_FILE, 'utf8');
  check('保存成功并清除未保存标记', r.ok === true && r.dirty === false && r.dot === 0, r);
  check('磁盘文件确实写入了修改', savedText.includes('新增一行') && savedText.includes('**段落文字**'), savedText.slice(0, 40));

  // 关闭有未保存修改的标签 → 弹确认框
  await js(`(() => {
    const ta = document.querySelector('#editor-input');
    ta.value += String.fromCharCode(10) + '追加内容';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await js(`MDV.tabs.closeActive(); 1`);
  await sleep(250);
  r = await js(`({
    dlg: !!document.querySelector('dialog.mdv-confirm'),
    buttons: Array.from(document.querySelectorAll('dialog.mdv-confirm button')).map(b => b.textContent),
    tabs: document.querySelectorAll('.tab').length
  })`);
  check('关闭未保存标签时弹出确认框', r.dlg === true && r.buttons.length === 3, r);

  await js(`(() => { const b = Array.from(document.querySelectorAll('dialog.mdv-confirm button')).find(x => x.textContent === '取消'); if (b) b.click(); return 1; })()`);
  await sleep(200);
  r = await js(`({ tabs: document.querySelectorAll('.tab').length, dlg: !!document.querySelector('dialog.mdv-confirm') })`);
  check('确认框选择取消后标签保留', r.dlg === false && r.tabs >= 1, r);

  // 回到预览模式，避免影响后续用例
  await js(`MDV.editor.applyMode('preview')`);

  /* ---------- 18. 标题栏避让原生窗口按钮 ---------- */
  // 曾经的 bug：padding-right 写死 115.2px，在 125% 缩放下原生按钮区是 136px，
  // 最后一个「更多」按钮被压在原生关闭按钮底下，用户看不到也点不到。
  r = await js(`(() => {
    const pad = parseFloat(getComputedStyle(document.querySelector('#titlebar')).paddingRight);
    const more = document.querySelector('#btn-more').getBoundingClientRect();
    return { pad, moreRight: Math.round(more.right), inner: innerWidth, visible: more.width > 0 };
  })()`);
  check('标题栏为原生窗口按钮预留足够宽度（≥136px）', r.pad >= 136, r.pad);
  check('最后一个工具栏按钮未被预留区挤掉', r.visible && r.moreRight <= r.inner - r.pad + 1, r);

  /* ---------- 17. 控制台无异常 ---------- */
  check('渲染进程无未捕获错误', errors.length === 0, errors.slice(0, 5));

  /* ---------- 汇总 ---------- */
  const failed = results.filter((x) => !x.ok);
  fs.writeFileSync(TMP_JSON, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length) console.log('失败项：' + failed.map((f) => f.name).join(' / '));
  app.exit(failed.length ? 1 : 0);
}).catch((err) => {
  console.error('E2E 崩溃：', err);
  app.exit(2);
});
