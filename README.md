# Markdown 查看器（Markdown Viewer）

一款 Windows 本地 **只读** Markdown 阅读器：双击 `.md` 就能舒服地读完，不修改、不上传、不联网。

![Electron](https://img.shields.io/badge/Electron-33-47848f) ![Version](https://img.shields.io/badge/version-1.2.0-blue) ![Platform](https://img.shields.io/badge/platform-Windows-lightgrey) ![License](https://img.shields.io/badge/license-MIT-green)

## 下载安装

前往 [Releases](../../releases) 下载：

- `MarkdownViewer-Setup-x.x.x.exe` —— NSIS 安装包（注册 `.md` / `.markdown` / `.mdx` 打开方式）
- `MarkdownViewer-Portable-x.x.x.exe` —— 便携版，免安装

安装后如想双击直接打开，请右键 `.md` 文件 → 打开方式 → 选择「Markdown 查看器」→ 勾选「始终」。

## 为什么用它，而不是编辑器

它不是编辑器，也**不打算变成编辑器**。只读带来两个直接好处：

1. **永远不会改坏你的文件**（不写盘、不做格式化、不"顺手"补空格）；
2. **打开快、占内存小**，适合"看一眼就关"的高频场景。

## 功能

### 阅读

- **正文排版**：GFM 表格、任务列表、引用、多级标题、代码高亮（VS Code Dark+ / Light+ 配色）、图片、分隔线
- **公式**：`$...$` 与 `$$...$$`，KaTeX 渲染（可关）
- **图表**：` ```mermaid ` 就地渲染，首次用到才加载运行时（可关）；渲染失败会回退显示源码
- **front matter**：YAML 头自动折叠成一行，不再当作正文
- **表格**：宽表格横向滚动，表头吸顶
- **代码块**：右上角语言标签 + 一键复制
- **图片**：点击放大，滚轮缩放、拖动平移、双击复位
- **阅读设置**：字号、行高、行宽、正文字体、换行策略、渲染开关，全部即时生效并记忆
- **主题**：深色 / 浅色 / 跟随系统，标题栏同步配色，启动无闪屏

### 导航

- **标签页**：多文档并行，Ctrl+Tab 切换，中键或 Ctrl+W 关闭
- **大纲**：标题树 + 当前章节跟随高亮，Ctrl+Shift+O 呼出
- **文档内查找**：Ctrl+F，全部命中高亮 + 计数 + Enter/Shift+Enter 跳转（CSS Highlight API，不改动 DOM，不破坏滚动位置）
- **文件树**：打开文件夹作为工作区，层级缩进、筛选、自动定位并高亮当前文件、记忆展开状态
- **导航历史**：Alt+← / Alt+→ 在文档间前进后退，与浏览器一致
- **相对链接**：`../other.md` 这类跨目录链接可正常跳转（含中文文件名）

### 输出

- **导出 PDF**：A4、携带背景色、自动淡出应用外壳（只留正文）
- **打印**：打印样式专门调过，白底黑字，代码块/表格不跨页断裂

### 工程

- 文件被外部修改后**即时**刷新（`fs.watch`，非轮询）；被删除时顶部给出提示条
- 单实例；拖放文件或文件夹即打开；窗口大小与滚动位置记忆；退出时恢复上次标签
- 路径守卫 + DOMPurify 清洗 + CSP 三重收口：文档里的脚本、事件属性、`javascript:` 链接都进不来

## 界面

- 深色：顶栏 `#17191a`、页面 `#1a1b1d`、正文 `#d1d3db`、行内代码 `#d7ba7d`
- 浅色：VS Code Light+ 风格

## 开发

```bash
npm install      # 安装依赖（Electron 33 / marked / highlight.js / KaTeX / mermaid / DOMPurify）
npm start        # 本地运行（prestart 自动把第三方产物复制到 src/renderer/vendor）
npm run dist     # 打包 NSIS 安装包 + 便携版（输出到 dist/）
```

### 自检

```bash
npm run check    # 语法自检（node --check）+ 渲染管线回归测试（37 项）
npm run e2e      # 真实 Electron 交互回归（46 项：标签/链接/查找/大纲/复制/设置/监听/XSS/PDF）
npm run shot     # 渲染指定文件并截图，用于肉眼验收
```

`npm run shot` 支持的环境变量：

| 变量 | 作用 |
|---|---|
| `MDV_FILE` | 要渲染的 .md 绝对路径 |
| `MDV_SHOT` | 输出 PNG 路径 |
| `MDV_SCROLL` | 截图前滚动到的像素位置 |
| `MDV_ACTION` | 截图前执行的 JS（驱动面板、主题等） |
| `MDV_PRINT=1` | 用打印媒体模拟，验收打印排版 |
| `MDV_CLEAR=1` | 清空 localStorage，从干净状态开始 |

> 开发提示：若环境里存在 `ELECTRON_RUN_AS_NODE=1`，Electron 会退化成纯 Node。`tools/shot.js` 与 `tools/e2e.js` 已内置自举守卫，会自动以正确的 Electron 模式重新拉起自己。

## 目录结构

```
markdown_viewer/
├── src/
│   ├── main.js           # 主进程：窗口、菜单、单实例、启动主题
│   ├── ipc.js            # IPC：读文件/目录、文件监听、导出 PDF、打印
│   ├── guard.js          # 路径守卫（扩展名白名单 + 穿越拦截 + realpath）
│   ├── exts.js           # 扩展名单一来源
│   ├── winpath.js        # Windows 路径归一化（前后端共用，修 ../ 的关键）
│   ├── render-md.js      # Markdown → HTML 管线（纯函数，可被 node 直接测试）
│   ├── preload.js        # 预加载：contextBridge 暴露受控 API
│   └── renderer/
│       ├── index.html
│       ├── style.css
│       ├── js/           # util / view / find / outline / lightbox / sidebar / tabs / settings / main
│       └── vendor/       # 第三方产物（自动生成，不入库）
├── tools/
│   ├── vendor.js         # 复制 KaTeX / mermaid / DOMPurify 到 vendor
│   ├── smoke.js          # 渲染管线回归测试
│   ├── e2e.js            # 交互回归测试（真实 Electron）
│   ├── shot.js           # 截图验收
│   ├── lint.js           # 语法自检
│   └── ensure-electron.js
├── docs/                 # 产品分析文档
└── package.json
```

## 已知限制（有意为之）

| 限制 | 原因 |
|---|---|
| 不能编辑 | 只读是产品定位：不改用户文件，就永远弄不坏用户文件 |
| 无自动更新 | 需要发布源与签名密钥；当前只提供下载链接，不做「点了没反应」的假更新 |
| 无大文件虚拟滚动 | 目前用「超过 1.5MB 自动关闭语法高亮」保流畅，真正窗口化渲染风险高于收益 |
| 不做分屏拖拽 | 对照阅读用「新窗口」或标签页 |

## License

[MIT](LICENSE)
