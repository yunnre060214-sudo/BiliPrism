# BiliPrism 映棱

Bilibili 网页端增强扩展，面向 Chrome 和 Microsoft Edge。当前版本 **0.1.4**，通过 GitHub Release 提供本地解压安装包。

以 MARGIN 0.39.0 为界面底座，保留首页、推荐、搜索、收藏、稍后再看、足迹及原生播放页适配。全站使用普通高斯模糊，背景使用静态渐变或本地图片，移除了 WebGL / WebGPU 背景与玻璃位移折射。默认关闭天气、开场和封面自动预览，字体直接使用系统字体。

## 下载与使用

1. 在 [Releases](https://github.com/yunnre060214-sudo/BiliPrism/releases) 下载 `BiliPrism-v0.1.4-chromium.zip`，解压到固定文件夹。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
3. 选择「加载已解压的扩展程序」，选择含 `manifest.json` 的文件夹。
4. 停用其他接管 B 站界面的扩展与重复功能脚本，刷新 B 站。

更新时覆盖原文件夹、在扩展管理页重新加载，然后刷新 B 站；设置保存在本机。详细说明见 [INSTALL.md](INSTALL.md)。

## 本版功能

- MARGIN 风格首页、亮暗主题、命令面板、视频右键菜单、关键词和 UP 主过滤。
- 收藏、稍后再看、足迹热力图及搜索、空间、动态、消息与阅读页的界面适配。
- **全屏滚轮调音**：基于 BewlyCat 的滚轮累积处理移植，支持步长设置；列表和可滚动菜单继续使用原生滚动。
- **播放速度记忆**：在 B 站原生播放器调速，下次视频继续使用所选速度；兼容 `video` 和 `bwp-video`。
- **宽屏布局**：使用原生宽屏按钮或在设置中默认启用。
- **字幕导出**：按 Ctrl / ⌘ + K，在命令面板选择「导出字幕」，弹窗选择语言与 SRT、TXT 或 JSON，支持分 P。
- **树状评论**：基于 BewlyCat 的父回复关系、树序与连线几何实现缩进、分支折叠；保留原生回复、翻页和评论节点。设置可随时关闭。
- 设置和足迹 JSON 备份导入、导出；扩展弹窗提供总开关与主题切换。

字幕能力取决于视频是否提供字幕及账号访问权限。扩展仅导出接口已允许访问的字幕。播放、弹幕、清晰度、全屏和评论继续由 B 站原生功能负责。

## 第一版边界

这是融合工程的首个可运行版本。BewlyCat 的大部分 Vue 功能尚未移植；个人 Userscripts 的完整源码尚未纳入，评论楼层导出、直播与「预言」等功能留待后续接入。本版字幕导出为独立实现，未声称完整移植 vcaptions 或 BiliForge。

当前验证包含构建、自动化逻辑测试及离线接口夹具下的扩展冒烟测试，真实账号、地区限制及 B 站线上页面变化仍需要本地使用反馈。

## 开发

需要 Node.js 22.12+ 或 24，打包命令需要 `zip`。

```bash
npm ci
npm test
npm run pack
npx playwright install --with-deps chromium
npm run test:smoke
npm run test:enhancements
```

`dist/` 可直接本地加载，`release/` 包含 ZIP 与 SHA-256 校验。推送新的 `package.json` 版本到 main 后，GitHub Actions 会运行验证，为该提交创建版本标签与 Release。不会向浏览器商店提交。

## 架构与来源

`src/shared` 管理设置与足迹格式；`src/content/main.ts` 负责路由与故障回退；`src/content/pages` 按页面加载；`src/content/enhancements` 放播放器增强与字幕逻辑；后台仅负责本地足迹合并。

存储使用 `biliprism:` 命名空间，与上游设置隔离。部分 DOM/CSS 的 `margin-*` 名称暂时沿用，以减少移植时的布局回归。BiliPrism 是独立项目，与 Bilibili、MARGIN、BewlyCat 官方没有从属关系。

代码来源、固定版本及许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；后续计划见 [docs/ROADMAP.md](docs/ROADMAP.md)。
