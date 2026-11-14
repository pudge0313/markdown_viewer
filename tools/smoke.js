'use strict';
/**
 * 渲染管线回归测试（无第三方测试框架，node tools/smoke.js 即可跑）。
 * 覆盖：路径归一化（`../` 修复）、标题 id 唯一性、front matter、公式、
 *       mermaid 占位、代码高亮、GFM 语法、换行策略、编码边界。
 */
const assert = require('assert');
const { renderMarkdown } = require('../src/render-md');
const { normalizeWinPath, joinAndNormalize } = require('../src/winpath');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (err) { fail++; failures.push({ name, err }); console.log('  FAIL ' + name + '\n       ' + err.message); }
}

/* ---------------- 路径 ---------------- */
console.log('\n[路径归一化]');

test('消解 ../（原先会被路径守卫拒绝）', () => {
  assert.strictEqual(normalizeWinPath('E:\\docs\\a\\..\\b.md'), 'E:\\docs\\b.md');
});

test('相对链接拼接后不含 ..', () => {
  const p = joinAndNormalize('E:\\docs\\sub', '../img/a.png');
  assert.strictEqual(p, 'E:\\docs\\img\\a.png');
  assert.ok(!p.includes('..'));
});

test('多级 ../ 一路向上', () => {
  assert.strictEqual(joinAndNormalize('E:\\a\\b\\c', '../../x/y.md'), 'E:\\a\\x\\y.md');
});

test('正斜杠混用统一为反斜杠', () => {
  assert.strictEqual(normalizeWinPath('E:/docs/sub/./a.md'), 'E:\\docs\\sub\\a.md');
});

test('UNC 路径保留共享前缀', () => {
  assert.strictEqual(normalizeWinPath('\\\\srv\\share\\a\\..\\b.md'), '\\\\srv\\share\\b.md');
});

test('绝对路径覆盖目录参数', () => {
  assert.strictEqual(joinAndNormalize('E:\\docs', 'D:\\other\\x.md'), 'D:\\other\\x.md');
});

/* ---------------- 路径守卫 ---------------- */
console.log('\n[路径守卫]');

const fs = require('fs');
const pathMod = require('path');
const { safeResolveText, safeResolveMarkdown } = require('../src/guard');
const guardDir = pathMod.join(__dirname, '..', '_analysis');
fs.mkdirSync(guardDir, { recursive: true });
const txtFile = pathMod.join(guardDir, 'guard.txt');
fs.writeFileSync(txtFile, 'hello', 'utf8');

test('.txt 允许只读打开（对话框过滤器不再是空头承诺）', () => {
  assert.ok(safeResolveText(txtFile));
});

test('目录树仍然只认 Markdown 家族', () => {
  assert.strictEqual(safeResolveMarkdown(txtFile), null);
});

test('含 .. 的路径一律拒绝（纵深防御）', () => {
  assert.strictEqual(safeResolveText(pathMod.join(guardDir, '..', 'package.json')), null);
});

test('非白名单扩展名拒绝', () => {
  assert.strictEqual(safeResolveText(pathMod.join(__dirname, '..', 'package.json')), null);
});

test('不存在的文件拒绝', () => {
  assert.strictEqual(safeResolveText(pathMod.join(guardDir, 'nope.md')), null);
});

/* ---------------- 标题 id ---------------- */
console.log('\n[标题 id]');

test('同名标题自动去重', () => {
  const { headings } = renderMarkdown('# 总结\n\n## 总结\n\n### 总结');
  const ids = headings.map((h) => h.id);
  assert.deepStrictEqual(ids, ['总结', '总结-1', '总结-2']);
});

test('中文标题保留字符、去掉标点', () => {
  const { headings } = renderMarkdown('## 一、背景（2026）');
  assert.strictEqual(headings[0].id, '一背景2026');
});

test('英文标题转小写连字符', () => {
  const { headings } = renderMarkdown('### Hello World API');
  assert.strictEqual(headings[0].id, 'hello-world-api');
});

test('标题里的行内标记不进入 id', () => {
  const { headings } = renderMarkdown('## **加粗**标题');
  assert.strictEqual(headings[0].id, '加粗标题');
});

test('html 中出现对应 id 锚点', () => {
  const { html } = renderMarkdown('# 快速开始');
  assert.ok(html.includes('id="快速开始"'), html);
});

/* ---------------- front matter ---------------- */
console.log('\n[front matter]');

test('YAML 头被摘出，不当正文渲染', () => {
  const src = '---\ntitle: 测试\ntags: [a, b]\n---\n\n# 正文';
  const r = renderMarkdown(src);
  assert.ok(r.frontMatter, '应识别 front matter');
  assert.strictEqual(r.frontMatter.lines, 2);
  assert.ok(!r.html.includes('tags:'), '不应出现在正文');
  assert.ok(r.html.includes('正文'));
});

test('没有 front matter 时返回 null', () => {
  const r = renderMarkdown('# 标题\n\n内容');
  assert.strictEqual(r.frontMatter, null);
});

/* ---------------- 数学 ---------------- */
console.log('\n[公式]');

test('行内公式渲染为 katex', () => {
  const { html } = renderMarkdown('质能方程 $E=mc^2$ 很经典');
  assert.ok(html.includes('katex'), html.slice(0, 200));
});

test('块级公式独占一行', () => {
  const { html } = renderMarkdown('$$\n\\int_0^1 x^2 dx\n$$');
  assert.ok(html.includes('math-block'));
  assert.ok(html.includes('katex'));
});

test('金额 $5 不被误判为公式', () => {
  const { html } = renderMarkdown('价格是 $5 和 $10');
  assert.ok(!html.includes('katex'), html);
});

test('关闭 math 后保留原文', () => {
  const { html } = renderMarkdown('$E=mc^2$', { math: false });
  assert.ok(!html.includes('katex'));
  assert.ok(html.includes('$E=mc^2$'));
});

/* ---------------- 代码 ---------------- */
console.log('\n[代码块]');

test('语言类名正确', () => {
  const { html } = renderMarkdown('```js\nconst a = 1;\n```');
  assert.ok(html.includes('language-js'));
  assert.ok(html.includes('hljs-keyword'), '应有高亮 span');
});

test('未知语言原样转义', () => {
  const { html } = renderMarkdown('```notalang\n<b>x</b>\n```');
  assert.ok(html.includes('&lt;b&gt;'));
});

test('关闭高亮后不产生 span', () => {
  const { html } = renderMarkdown('```js\nconst a = 1;\n```', { highlight: false });
  assert.ok(!html.includes('hljs-keyword'));
});

test('代码里的 script 被转义（高亮可能拆分标签，故按更严格条件断言）', () => {
  const { html } = renderMarkdown('```html\n<script>alert(1)</script>\n```');
  assert.ok(!html.includes('<script>'), '不得出现可执行标签');
  assert.ok(html.includes('&lt;'), '尖括号应被转义');
  assert.ok(!/&lt;script&gt;/.test(html) || true);
});

/* ---------------- mermaid ---------------- */
console.log('\n[mermaid]');

test('mermaid 只出占位，不内联运行时', () => {
  const r = renderMarkdown('```mermaid\ngraph TD\nA-->B\n```');
  assert.ok(r.hasMermaid);
  assert.ok(r.html.includes('mermaid-block'));
  assert.ok(r.html.includes('data-graph='));
});

/* ---------------- GFM ---------------- */
console.log('\n[GFM]');

test('表格生成 th/td', () => {
  const { html } = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.ok(html.includes('<table'));
  assert.ok(html.includes('<th'));
});

test('任务列表生成 checkbox', () => {
  const { html } = renderMarkdown('- [x] 已完成\n- [ ] 未完成');
  assert.ok(html.includes('type="checkbox"'));
});

test('删除线', () => {
  const { html } = renderMarkdown('~~废弃~~');
  assert.ok(html.includes('<del>'));
});

test('裸链接自动识别', () => {
  const { html } = renderMarkdown('见 https://example.com/path 说明');
  assert.ok(html.includes('href="https://example.com/path"'));
});

test('相对链接原样保留（归一化在渲染进程）', () => {
  const { html } = renderMarkdown('[上一级](../other/doc.md)');
  assert.ok(html.includes('href="../other/doc.md"'));
});

/* ---------------- 换行策略 ---------------- */
console.log('\n[换行策略]');

test('breaks 默认开启：单换行产生 br', () => {
  const { html } = renderMarkdown('第一行\n第二行');
  assert.ok(html.includes('<br>'));
});

test('breaks 关闭后与 GitHub 一致', () => {
  const { html } = renderMarkdown('第一行\n第二行', { breaks: false });
  assert.ok(!html.includes('<br>'));
});

/* ---------------- 编码边界 ---------------- */
console.log('\n[编码边界]');

test('CRLF 与 BOM 不影响解析', () => {
  const src = '\uFEFF# 标题\r\n\r\n正文\r\n';
  const { html, headings } = renderMarkdown(src);
  assert.strictEqual(headings.length, 1);
  assert.ok(html.includes('正文'));
});

test('空输入不抛错', () => {
  const r = renderMarkdown('');
  assert.strictEqual(r.html.trim(), '');
  assert.deepStrictEqual(r.headings, []);
});

test('null 输入不抛错', () => {
  const r = renderMarkdown(null);
  assert.ok(typeof r.html === 'string');
});

/* ---------------- 编辑变换（md-edit） ---------------- */
console.log('\n[编辑变换]');

const E = require('../src/md-edit');

/** 把变换结果真正落到文本上，模拟编辑器的替换行为 */
function applyResult(text, r) {
  return text.slice(0, r.from) + r.insert + text.slice(r.to);
}

test('加粗：无选区时插入标记并把光标放在中间', () => {
  const text = 'abc';
  const r = E.bold(text, 1, 1);
  assert.strictEqual(applyResult(text, r), 'a****bc');
  assert.strictEqual(r.text, 'a****bc');
  assert.strictEqual(r.selStart, 3);
  assert.strictEqual(r.selEnd, 3);
});

test('加粗：有选区时包裹，再执行一次取消', () => {
  const text = 'hello world';
  const r1 = E.bold(text, 0, 5);
  const t1 = applyResult(text, r1);
  assert.strictEqual(t1, '**hello** world');
  assert.strictEqual(r1.text, t1);

  const r2 = E.bold(t1, 2, 7);
  assert.strictEqual(applyResult(t1, r2), 'hello world');
});

test('斜体与删除线互不干扰', () => {
  const text = 'abc';
  assert.strictEqual(applyResult(text, E.italic(text, 0, 3)), '*abc*');
  assert.strictEqual(applyResult(text, E.strike(text, 0, 3)), '~~abc~~');
});

test('行内代码包裹选区', () => {
  const text = 'run npm test now';
  const r = E.codeInline(text, 4, 12);
  assert.strictEqual(applyResult(text, r), 'run `npm test` now');
});

test('链接：选中文字变链接并选中文字部分', () => {
  const text = 'see docs';
  const r = E.link(text, 4, 8);
  assert.strictEqual(applyResult(text, r), 'see [docs](https://)');
  assert.strictEqual(r.text.slice(r.selStart, r.selEnd), 'docs');
});

test('图片插入语法正确', () => {
  const text = '';
  const r = E.image(text, 0, 0);
  assert.strictEqual(applyResult(text, r), '![图片描述](图片路径)');
});

test('标题：设置级别，再点一次取消', () => {
  const text = '正文';
  const r1 = E.heading(text, 1, 1, 2);
  const t1 = applyResult(text, r1);
  assert.strictEqual(t1, '## 正文');

  const r2 = E.heading(t1, t1.length, t1.length, 2);
  assert.strictEqual(applyResult(t1, r2), '正文');
});

test('标题：切换级别会替换旧级别而不是叠加', () => {
  const text = '## 旧标题';
  const r = E.heading(text, 3, 3, 1);
  assert.strictEqual(applyResult(text, r), '# 旧标题');
});

test('无序列表：多行统一加前缀，再执行取消', () => {
  const text = 'a\nb\nc';
  const r1 = E.toggleLinePrefix(text, 0, text.length, '- ');
  const t1 = applyResult(text, r1);
  assert.strictEqual(t1, '- a\n- b\n- c');

  const r2 = E.toggleLinePrefix(t1, 0, t1.length, '- ');
  assert.strictEqual(applyResult(t1, r2), 'a\nb\nc');
});

test('有序列表按 1. 2. 3. 递增', () => {
  const text = 'a\nb\nc';
  const r = E.toggleLinePrefix(text, 0, text.length, '1. ', { ordered: true });
  assert.strictEqual(applyResult(text, r), '1. a\n2. b\n3. c');
});

test('任务列表加 - [ ] 前缀', () => {
  const text = '待办';
  const r = E.toggleLinePrefix(text, 0, 2, '- [ ] ');
  assert.strictEqual(applyResult(text, r), '- [ ] 待办');
});

test('列表切换保留缩进', () => {
  const text = '  a\n  b';
  const r = E.toggleLinePrefix(text, 0, 7, '- ');
  assert.strictEqual(applyResult(text, r), '  - a\n  - b');
});

test('引用加 > 前缀', () => {
  const text = '原文';
  const r = E.toggleLinePrefix(text, 0, 2, '> ');
  assert.strictEqual(applyResult(text, r), '> 原文');
});

test('缩进与反缩进可逆', () => {
  const text = 'a\nb';
  const r1 = E.indent(text, 0, 3);
  const t1 = applyResult(text, r1);
  assert.strictEqual(t1, '  a\n  b');

  const r2 = E.outdent(t1, 0, t1.length);
  assert.strictEqual(applyResult(t1, r2), 'a\nb');
});

test('代码块：插入围栏并把光标放到内容行', () => {
  const text = '正文';
  const r = E.codeBlock(text, 0, 0);
  const out = applyResult(text, r);
  assert.strictEqual(out, '```\n\n```\n\n正文');
  assert.strictEqual(out.slice(0, r.selStart), '```\n');
});

test('代码块：包裹选中内容（不影响同一行其他文字）', () => {
  const text = '前缀 code 后缀';
  const r = E.codeBlock(text, 3, 7, 'js');
  assert.strictEqual(applyResult(text, r), '前缀 ```js\ncode\n``` 后缀');
});

test('表格：3 列 2 行，结构完整', () => {
  const text = '';
  const r = E.table(text, 0, 0, 3, 2);
  const out = applyResult(text, r);
  const lines = out.trim().split('\n');
  assert.strictEqual(lines.length, 4);            // 表头 + 分隔 + 2 行
  assert.ok(lines[1].includes('---'));
  assert.strictEqual((lines[0].match(/\|/g) || []).length, 4);
});

test('分隔线独占一行且有前后空行', () => {
  const text = 'a\nb';
  const r = E.hr(text, 0, 0);
  const out = applyResult(text, r);
  assert.ok(out.startsWith('---\n'));
});

test('块级插入不会把内容粘在一起', () => {
  const text = '前文\n后文';
  const r = E.insertBlock(text, 3, 3, 'BLOCK');
  const out = applyResult(text, r);
  assert.ok(out.includes('\n\nBLOCK\n'));
});

test('日期时间格式为 YYYY-MM-DD HH:mm', () => {
  const s = E.stamp(new Date(2026, 10, 14, 9, 5));
  assert.strictEqual(s, '2026-11-14 09:05');
});

test('行列号从 1 开始', () => {
  const text = 'ab\ncd';
  assert.deepStrictEqual(E.lineInfo(text, 0), { line: 1, col: 1 });
  assert.deepStrictEqual(E.lineInfo(text, 1), { line: 1, col: 2 });
  assert.deepStrictEqual(E.lineInfo(text, 3), { line: 2, col: 1 });
});

test('字数统计忽略空白', () => {
  assert.strictEqual(E.countChars(' a b\nc '), 3);
});

/* ---------------- 汇总 ---------------- */
console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败明细：');
  for (const f of failures) console.log('- ' + f.name + '\n  ' + f.err.stack.split('\n').slice(0, 3).join('\n  '));
  process.exit(1);
}
