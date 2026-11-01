import { every } from '../sched';
// B 站原生评论（bili-comments，lit 组件，多层 open shadow root）外层 CSS 进不去：
// 找到关键组件后往它们的 shadowRoot 里追加一张样式表，变量从 html 继承（--m-*）。
const SKINS: Record<string, string> = {
  'bili-comments-header-renderer': `
    #navbar { align-items: center !important; margin: 0 0 20px !important; padding-top: 0 !important; }
    #title { display: flex !important; align-items: baseline !important; gap: 8px !important; }
    #title h2 { margin: 0 !important; font: 400 24px/1.2 var(--m-serif, serif) !important; letter-spacing: .04em !important; color: var(--m-ink) !important; }
    #count { font: 400 13px/1 var(--m-mono, monospace) !important; color: var(--m-faint) !important; margin: 0 !important; }
    #sort-actions { display: inline-flex !important; align-items: center !important; gap: 2px !important; margin-left: 20px !important; padding: 3px !important; border-radius: 999px !important; background: var(--m-chip) !important; box-shadow: var(--ring) !important; }
    #sort-actions .sort-div { display: none !important; }
    #sort-actions bili-text-button { display: inline-flex; align-items: center; height: 28px; padding: 0 14px; border-radius: 999px; font-size: 13px; color: var(--m-muted); --bili-text-button-color: var(--m-muted); --bili-text-button-hover-color: var(--m-ink); cursor: pointer; transition: background .2s, color .2s, box-shadow .2s; }
    #sort-actions bili-text-button:hover { color: var(--m-ink); }
    #sort-actions.hot bili-text-button:first-of-type, #sort-actions:not(.hot) bili-text-button:last-of-type { background: var(--m-surface); color: var(--m-ink); --bili-text-button-color: var(--m-ink); box-shadow: var(--ring), var(--sh-xs); }
    #disabled-commentbox #edit { border: 0 !important; border-radius: 14px !important; background: var(--m-chip) !important; box-shadow: var(--ring) !important; color: var(--m-muted) !important; }
    #disabled-commentbox #edit button { border-radius: 999px !important; }
  `,
  'bili-comment-box': `
    #editor { background: var(--m-chip) !important; border: 0 !important; border-radius: 14px !important; box-shadow: var(--ring) !important; padding: 10px 14px !important; transition: box-shadow .2s, background .2s !important; }
    #editor:hover { background: color-mix(in srgb, var(--m-ink) 7%, transparent) !important; }
    #editor:focus-within, #editor.active { background: var(--m-surface) !important; box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--m-accent) 55%, transparent), var(--sh-xs) !important; }
    #footer .tool-btn { border-radius: 8px !important; }
    #pub button { border-radius: 999px !important; padding: 0 18px !important; }
  `,
  'bili-comment-rich-textarea': `
    #input, .brt-root, .brt-editor { background: transparent !important; color: var(--m-ink) !important; font-size: 14px !important; line-height: 1.6 !important; }
    .brt-placeholder, [data-placeholder]::before { color: var(--m-faint) !important; }
  `,
};

const done = new WeakSet<ShadowRoot>();
let extra: Record<string, string> = {};
const sheets = new Map<string, CSSStyleSheet>();

function skin(root: ParentNode, depth = 0): void {
  if (depth > 6) return;
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    const sr = el.shadowRoot;
    if (!sr) continue;
    const tag = el.tagName.toLowerCase();
    const css = SKINS[tag] ? SKINS[tag] + (extra[tag] ?? '') : undefined;
    if (css && !done.has(sr)) {
      let s = sheets.get(tag);
      if (!s) { s = new CSSStyleSheet(); s.replaceSync(css); sheets.set(tag, s); }
      sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, s];
      done.add(sr);
    }
    // 只往评论头部 / 输入框所在的层级钻，不遍历每条评论（数量多）
    if (tag === 'bili-comments' || tag === 'bili-comments-header-renderer' || tag === 'bili-comment-box') skin(sr, depth + 1);
  }
}

/** extra：按页面追加到某个组件皮肤后面的样式（详情页隐藏评论区重复的大标题） */
export function skinComments(more: Record<string, string> = {}): void {
  extra = more;
  const run = () => { const bc = document.querySelector('bili-comments'); if (bc) skin(bc.parentElement ?? document); };
  // 前 90 秒每秒补一次（评论区是懒加载的 Web Components）；页面隐藏时暂停
  let n = 0;
  const stop = every(1000, () => { run(); if (++n > 90) stop(); });
  let pending = 0;
  addEventListener('scroll', () => { if (pending) return; pending = window.setTimeout(() => { pending = 0; run(); }, 400); }, { passive: true });
}
