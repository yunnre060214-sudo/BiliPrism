# Third-party notices

## MARGIN

主要界面、Bilibili API 客户端、主题、足迹、收藏与页面适配来自：

- Repository: https://github.com/jiuyang5354/bilibili-margin
- Version: 0.39.0
- Commit: `b871c904a45606e754da3a1c6b78fde738c6e5b4`
- Copyright (c) 2026 jiuyang5354
- License: MIT, full text in `licenses/MARGIN-MIT.txt` and root `LICENSE`.

BiliPrism 修改了品牌、存储命名空间、构建与发布流程，替换了光学玻璃、动态背景和开场引擎，移除了打包字体，并加入独立播放器增强。上游设计参考的原始记录见 `docs/upstream-design-references.md`，其中提到的部分历史渲染实现和字体不包含在本发行版中。

## BewlyCat

- Repository: https://github.com/keleus/BewlyCat
- Version: 1.8.3
- Commit: `f11de77051bbc8896f9038e51cc3af88e737cc5c`
- Copyright (c) 2025 Keleus <jen.hs@outlook.com>
- Copyright (c) 2021 Hakadao <hakadao2000@gmail.com>
- License: upstream Custom License based on MIT; full original text is included in `licenses/BewlyCat-LICENSE.txt`.

`src/content/enhancements/values.ts` adapts the normalization helpers from `src/utils/wheelVolume.ts` and `src/utils/playbackRate.ts`. `src/content/pages/enhancements.ts` adapts wheel accumulation, scrollable-area handling and fullscreen-only listener scheduling from `src/contentScripts/fullscreenWheelVolume.ts`, replacing Vue state with the BiliPrism lifecycle. The upstream restrictions against non-browser-client distribution remain applicable to these derived portions. This release is a browser extension.

`src/content/comments/geometry.ts` preserves the shared SVG branch geometry from `src/utils/commentReplyTree.ts`. The comment data access, parent-first traversal, time ordering, indentation and branch controls in `src/content/comments/{tree,main}.ts` adapt the native comment-tree approach in `src/inject/index.ts`. BiliPrism uses CSS order without moving native reply nodes or Lit repeat markers, and reads public custom-element data in the MAIN world without network interception. Missing off-page parents retain the native reply prefix; unknown relationships are not guessed.

## qrcode-generator

Copyright (c) 2009 Kazuhiko Arase. MIT license, included in `licenses/qrcode-generator-MIT.txt`. Used for account sign-in QR codes inherited from MARGIN. Build-only dependencies retain their package licenses.

New BiliPrism code is provided under the root MIT license, subject to the separately stated terms for derived components. Personal scripts and vcaptions source code are not included in v0.1.0.
