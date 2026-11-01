/**
 * 入口脚本（document_start 注入所有 B 站页面）：只做路由判断、读设置、注册字体、足迹心跳、
 * 先藏原版 / 拦原版脚本。各页面的界面代码按路由从 dist/pages/*.js 动态 import（和 flux.js 同一套做法），
 * 不再把整站代码塞进一个 447KB 的 content.js。
 */
import { loadSettings, onSettingsChange, type Settings } from '../shared/settings';
import { startTracking } from './footprint/beat';
import { injectFonts } from './fonts';
import { muteNative, setGuard, guardEnabled } from './native-guard';
import type { SkinKind } from './ui/watch';
import watchCss from './watch.css?inline';
import safeVideoCss from './video-safe.css?inline';
import pagesCss from './pages.css?inline';
import detailCss from './detail.css?inline';

// Firefox：内容脚本自带的 fetch 以扩展身份发请求，B 站接口收不到登录 cookie（一直显示未登录）。
// Firefox 另给了页面身份的 content.fetch，B 站自家域名的请求改走它；其他域名（天气等）照旧。Chrome 没有 content，不受影响。
const ffPage = (globalThis as { content?: { fetch?: typeof fetch } }).content;
if (typeof ffPage?.fetch === 'function') {
  const extFetch = globalThis.fetch.bind(globalThis);
  const pageFetch = ffPage.fetch.bind(ffPage);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return /^https:\/\/([\w-]+\.)*(bilibili\.com|hdslb\.com|biliapi\.net)\//.test(url) ? pageFetch(input, init) : extFetch(input, init);
  };
}

type Pages = {
  enhancements: typeof import('./pages/enhancements');
  home: typeof import('./pages/home');
  watch: typeof import('./pages/watch');
  space: typeof import('./pages/space');
  message: typeof import('./pages/message');
  history: typeof import('./pages/history');
  feed: typeof import('./pages/feed');
  detail: typeof import('./pages/detail');
};
/** 按需加载页面模块；content script 不能是 ES module，但可以动态 import 扩展里的 ES 模块 */
const load = <K extends keyof Pages>(name: K): Promise<Pages[K]> => import(/* @vite-ignore */ chrome.runtime.getURL(`pages/${name}.js`));

const HIDE_CSS = 'html{background:#111!important;overflow:hidden!important}body{display:none!important}@media (prefers-color-scheme: light){html{background:#f5f4f1!important}}';
/** document_start 时先把原页面藏起来，避免闪一下原版 */
function hideOriginal(): HTMLStyleElement {
  const hide = document.createElement('style');
  hide.id = 'margin-hide';
  hide.textContent = HIDE_CSS;
  document.documentElement.append(hide);
  return hide;
}

const isHome = () => location.hostname === 'www.bilibili.com' && /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/?)?(?:index\.html)?$/.test(location.pathname);

const isWatch = () => location.hostname === 'www.bilibili.com' && /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?video\/(?:BV|av)/i.test(location.pathname);
const isSearch = () => location.hostname === 'search.bilibili.com';
/** 其他接管的页面：除首页、播放页外的 B 站页面（空间、番剧、动态、历史、专栏、稍后再看…） */
const SKIP = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?(?:blackboard|correspond|v\/topic|festival|bnj|ssr)/;
const isPage = () => /^(www|space|t)\.bilibili\.com$/.test(location.hostname) && !SKIP.test(location.pathname) && window.top === window;
const LOC = '(?:[a-z]{2}(?:-[A-Za-z]{2,4})?/)?';
const spaceMatch = () => location.hostname === 'space.bilibili.com' ? location.pathname.match(new RegExp(`^/${LOC}(\\d+)(?:/(video|upload/video|dynamic|upload))?/?$`)) : null;
const isMessage = () => location.hostname === 'message.bilibili.com' && window.top === window;
const isHistory = () => location.hostname === 'www.bilibili.com' && /^\/(?:account\/)?history\/?$/.test(location.pathname) && window.top === window;
const isFeed = () => location.hostname === 't.bilibili.com' && /^\/?$/.test(location.pathname) && window.top === window;
/** 详情页：单条动态 / 图文 opus / 专栏 / 番剧播放（和 ui/detail.ts detailKind 保持一致） */
type DetailKind = 'opus' | 'dyn' | 'read' | 'bangumi';
function detailKind(): DetailKind | null {
  const h = location.hostname, p = location.pathname;
  if (h === 't.bilibili.com' && /^\/\d+\/?$/.test(p)) return 'dyn';
  if (h !== 'www.bilibili.com') return null;
  const m = p.match(new RegExp(`^/${LOC}(opus/\\d|read/cv\\d|bangumi/play/(?:ep|ss)\\d)`));
  return m ? (m[1].startsWith('opus') ? 'opus' : m[1].startsWith('read') ? 'read' : 'bangumi') : null;
}
const offByUrl = () => new URLSearchParams(location.search).get('biliprism') === 'off';

/**
 * 播放页 / 搜索页等换皮页面的全局样式。入口脚本里同步挂上（用 localStorage 里上次设置的镜像判断开没开），
 * 不等页面模块加载，避免先闪一下原版。
 */
const SKIN_KEY = 'biliprism:skin';
function skinMirror(): string | null { try { return localStorage.getItem(SKIN_KEY); } catch { return null; } }
function setSkinMirror(v: string): void { try { if (skinMirror() !== v) localStorage.setItem(SKIN_KEY, v); } catch { /* 隐私模式 */ } }
function skinStyle(kind: SkinKind, theme: string): HTMLStyleElement {
  const de = document.documentElement;
  de.classList.add('margin-skin', `margin-${kind}`);
  const dk = kind === 'page' ? detailKind() : null;
  if (dk) { de.classList.add('margin-detail'); de.dataset.marginDetail = dk; }
  de.dataset.marginTheme = theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  let st = document.getElementById('margin-watch-css') as HTMLStyleElement | null;
  if (!st) {
    st = document.createElement('style');
    st.id = 'margin-watch-css';
    st.textContent = kind === 'watch' ? safeVideoCss : watchCss + '\n' + pagesCss + '\n' + detailCss;
    de.append(st);
  }
  return st;
}
function unskin(kind: SkinKind): void {
  const de = document.documentElement;
  document.getElementById('margin-watch-css')?.remove();
  de.classList.remove('margin-skin', `margin-${kind}`, 'margin-has-bg', 'margin-detail', 'margin-detail-narrow');
  delete de.dataset.marginTheme;
  delete de.dataset.marginDetail;
}

async function startWatch(kind: SkinKind = 'watch'): Promise<void> {
  if (sessionStorage.getItem('biliprism:off') || offByUrl()) { sessionStorage.removeItem('biliprism:off'); return; }
  // 设置和页面模块并行读取
  const mod = load('watch');
  mod.catch(() => {});
  const mirror = skinMirror();
  if (mirror && mirror !== '0') skinStyle(kind, mirror);
  const settings = await loadSettings();
  const on = settings.enabled && settings.watch;
  setSkinMirror(on ? settings.theme : '0');
  if (kind === 'watch' && settings.enabled) {
    void load('enhancements').then(m => m.startPlayerEnhancements()).catch(e => console.error('[BiliPrism] 播放器增强加载失败', e));
  }
  if (!on) { unskin(kind); onSettingsChange((next, prev) => { if (next.enabled !== prev.enabled || next.watch !== prev.watch) location.reload(); }); return; }
  skinStyle(kind, settings.theme);
  const skin = await guarded('watch', () => mod.then((m) => new m.WatchSkin(settings, kind)), () => unskin(kind));
  if (!skin) return;
  // 详情页：右侧作者栏 / 目录 / 操作区按需加载；出错只影响侧栏，换皮照常
  const dk = kind === 'page' ? detailKind() : null;
  if (dk) {
    load('detail').then((m) => m.mountDetail(dk)).catch((e) => {
      console.error('[BiliPrism] 详情页侧栏加载失败：', e);
      document.getElementById('margin-aside')?.remove();
      document.documentElement.classList.add('margin-detail-narrow');
    });
  }
  onSettingsChange((next, prev) => {
    if (next.enabled !== prev.enabled || next.watch !== prev.watch) location.reload();
    else skin.update(next);
  });
}

/** 键盘导航模式：按 Tab 后在映棱的 Shadow DOM 宿主上标记 data-kbd，指针一按就撤销；样式里用 :host([data-kbd]) 给输入框外层画聚焦环 */
function trackKeyboard(): void {
  const hosts = () => ['margin-root', 'margin-watch-top'].map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
  addEventListener('keydown', (e) => { if (e.key === 'Tab') hosts().forEach((x) => { if (!('kbd' in x.dataset)) x.dataset.kbd = ''; }); }, true);
  addEventListener('pointerdown', () => hosts().forEach((x) => { if ('kbd' in x.dataset) delete x.dataset.kbd; }), true);
}

async function start(): Promise<void> {
  injectFonts();
  trackKeyboard();
  onSettingsChange((next, prev) => { if (next.enabled !== prev.enabled) location.reload(); });
  void loadSettings().then(s => { if (s.enabled && !offByUrl()) startTracking(); });
  if (isWatch()) return startWatch();
  const sm = spaceMatch();
  // 空间页的投稿接口依赖原版脚本写的指纹 cookie，不拦会 412
  if (sm) return takeover(load('space'), (m, st) => new m.SpaceApp(st, Number(sm[1]), sm[2] === 'dynamic' ? 'dynamic' : 'video'), false);
  if (isMessage()) return takeover(load('message'), (m, st) => new m.MessageApp(st));
  if (isHistory()) return takeover(load('history'), (m, st) => new m.HistoryApp(st));
  if (isFeed()) return takeover(load('feed'), (m, st) => new m.FeedApp(st));
  if (isSearch()) return startWatch('search');
  if (!isHome() && isPage()) return startWatch('page');
  if (!isHome() || sessionStorage.getItem('biliprism:off') || offByUrl()) {
    sessionStorage.removeItem('biliprism:off');
    return;
  }
  // Hide the original page as early as possible to avoid a flash.
  const hide = hideOriginal();
  const unmute = muteNative();
  const mod = load('home');
  mod.catch(() => {});

  const settings = await loadSettings();
  if (!settings.enabled) { hide.remove(); unmute(); return disabledAfterMute(); }
  setGuard(true);

  const app = await guarded('home', () => mod.then((m) => {
    const a = new m.MarginApp(settings);
    document.documentElement.append(a.host);
    return a;
  }), () => restoreNative(hide, guardEnabled()));
  if (!app) return;

  onSettingsChange((next, prev) => {
    if (next.enabled !== prev.enabled) location.reload();
    else app.update(next);
  });
}

/** 接管式页面：先藏原版，再挂映棱页面；设置里关掉「其他页面重设计」就保留原版 */
async function takeover<M>(mod: Promise<M>, make: (m: M, s: Settings) => { shell: { host: HTMLElement }; update(s: Settings): void }, mute = true): Promise<void> {
  mod.catch(() => {});
  if (sessionStorage.getItem('biliprism:off') || offByUrl()) { sessionStorage.removeItem('biliprism:off'); return; }
  const hide = hideOriginal();
  const unmute = mute ? muteNative() : () => {};
  const settings = await loadSettings();
  if (!settings.enabled || !settings.watch) { hide.remove(); unmute(); return mute ? disabledAfterMute() : undefined; }
  if (mute) setGuard(true);
  const name = location.hostname.split('.')[0] + location.pathname;
  const page = await guarded(name, () => mod.then((m) => {
    const p = make(m, settings);
    document.documentElement.append(p.shell.host);
    return p;
  }), () => restoreNative(hide, mute && guardEnabled()));
  if (!page) return;
  onSettingsChange((next, prev) => {
    if (next.enabled !== prev.enabled || next.watch !== prev.watch) location.reload();
    else page.update(next);
  });
}

/**
 * 页面模块加载或挂载出错时：记日志、拆掉映棱注入的界面，把这一页还给 B 站原版，而不是留一张空白页。
 * 调试钩子：localStorage['biliprism:test-throw'] 写页面名（home / watch / www/account/history …）时故意抛错，冒烟测试用。
 */
async function guarded<T>(name: string, mount: () => Promise<T>, restore: () => void): Promise<T | null> {
  try {
    let t: string | null = null;
    try { t = localStorage.getItem('biliprism:test-throw'); } catch { /* ignore */ }
    if (t && name.startsWith(t)) throw new Error(`margin:test-throw ${name}`);
    return await mount();
  } catch (e) {
    console.error('[BiliPrism] 页面模块挂载失败，这一页回到 B 站原版：', name, e);
    for (const id of ['margin-root', 'margin-watch-top', 'margin-bg']) document.getElementById(id)?.remove();
    try { restore(); } catch { /* ignore */ }
    return null;
  }
}

/** 撤掉遮罩；原版脚本已经被拦掉的话只能刷新一次（只这一次加载不接管），让原版完整加载 */
function restoreNative(hide: HTMLStyleElement, muted: boolean): void {
  hide.remove();
  document.documentElement.style.removeProperty('background');
  if (!muted) return;
  sessionStorage.setItem('biliprism:off', '1');
  location.reload();
}

/** 映棱被关掉但原版脚本已被拦：记下来，刷新一次让原版完整加载 */
function disabledAfterMute(): void {
  if (!guardEnabled()) return;
  setGuard(false);
  location.reload();
}

start().catch((e) => console.error("[BiliPrism]", e));
