# Markdown 查看器（Markdown Viewer）

一款 Windows 本地 Markdown（.md）文档查看器，深色 / 浅色双主题，排版对齐 VS Code 的 Markdown 预览效果。

![Electron](https://img.shields.io/badge/Electron-33-47848f) ![Version](https://img.shields.io/badge/version-1.1.0-blue) ![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

## 下载安装

前往 [Releases](../../releases) 下载 `MarkdownViewer-Setup-x.x.x.exe`，双击安装即可。

安装器会自动把应用注册到 `.md` / `.markdown` 的系统"打开方式"列表；如需双击直接打开，请在首次使用时右键 .md 文件 → 打开方式 → 选择"Markdown 查看器" → 勾选"始终"。

## 功能

- **打开文件**：双击 .md 文件、对话框（Ctrl+O）、拖放、最近打开列表
- **文件浏览**：工具栏按钮或 Ctrl+B 打开侧边栏，浏览并切换当前目录及子目录下的 .md 文件；文档内的相对链接可直接跳转
- **完整渲染**：多级标题、有序/无序列表、任务列表、GFM 表格、引用、代码块（VS Code Dark+/Light+ 语法高亮）、图片、链接、粗体/斜体、分隔线
- **深浅色主题**：左下角按钮一键切换，跟随记忆，原生标题栏同步配色
- **缩放**：Ctrl+滚轮 / 触摸板双指捏合，0.5x–2.4x，Ctrl+0 重置
- **自动刷新**：文件被外部编辑后约 2 秒自动重新渲染
- 其他：文件内锚点跳转、外部链接系统浏览器打开、窗口状态持久化、更多菜单（打开文件 / 在资源管理器中显示 / 设为默认打开程序 / 关于）

## 界面

- 深色模式：顶栏 `#17191a`、页面 `#1a1b1d`、正文 `#d1d3db`、行内代码 `#d7ba7d`
- 浅色模式：VS Code Light+ 风格配色

## 开发

```bash
npm install        # 安装依赖（Electron 33 + marked + highlight.js）
npm start          # 本地运行
npm run dist       # 打包 NSIS 安装包（输出到 dist/）
```

渲染指定文件并截图（开发调试用）：

```bash
MDV_FILE=<path.md> MDV_SHOT=<out.png> MDV_DSF=1.25 npm run shot
```

## 目录结构

```
md-viewer/
├── src/
│   ├── main.js          # 主进程：窗口、单实例、文件关联参数
│   ├── guard.js         # 路径校验（防路径穿越）
│   ├── ipc.js           # IPC 处理器（读文件/目录列表/主题/外部打开）
│   ├── preload.js       # 预加载：marked + highlight.js 渲染管线
│   └── renderer/        # 渲染进程：index.html / style.css / app.js
├── tools/shot.js        # 渲染截图工具（像素比对用）
├── assets/              # 应用图标
└── package.json         # electron-builder 配置（NSIS + 文件关联）
```

## License

[MIT](LICENSE)
