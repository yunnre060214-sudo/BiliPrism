import { every } from '../sched';
import type { Settings } from '../../shared/settings';
import { saveSettings } from '../../shared/settings';
import { h, ICONS } from './dom';
import { toast } from './controls';
import { addWatchLater } from '../api/search';
import { createFavorites } from './favorites';
import { createHeader, type Header, SITE_LINKS } from './header';
import { attachPreview } from './preview';
import { createSettingsPanel, type SettingsPanel } from './settings-panel';
import type { Sheet } from './sheet';
import { attachGlass, filtersIn } from './liquid-glass';
import { createFloatingMenu } from './floating-menu';
import { createCommandPalette, type Command } from './command-palette';
import { createContextMenu } from './context-menu';
import { bindCardMenu } from './card-menu';
import { createLaterDrawer } from './drawer';
import { createScrollRuler } from './scroll-ruler';
import { skinComments } from './comment-skin';
import css from '../styles.css?inline';
import { BackgroundLayer } from '../bg/background';
import { startTriple } from './triple';

export type SkinKind = 'watch' | 'search' | 'page';

/**
 * 播放页：不替换 B 站原生播放器、弹幕、评论，只做两件事——
 * 1) 换上和首页一致的顶栏（Shadow DOM）；
 * 2) 用全局样式重写 B 站的主题变量和版式（变量能穿透评论区的 Shadow DOM）。
 */
export class WatchSkin {
  readonly host: HTMLElement;
  private bg = new BackgroundLayer();
  private bgApp: HTMLElement;
  private app: HTMLElement;
  private head: Header;
  private panel: SettingsPanel;
  private fav: Sheet;
  private media = matchMedia('(prefers-color-scheme: dark)');

  constructor(private settings: Settings, private kind: SkinKind = 'watch') {
    const de = document.documentElement;
    const isWatch = kind === 'watch';
    // 全局换皮样式（watch.css + pages.css）由入口脚本在 document_start 挂上（见 main.ts skinStyle），这里只补类名
    de.classList.add('margin-skin', `margin-${kind}`);

    // Shader 背景：独立宿主，fixed 铺满、z-index -1，在 B 站内容之下、画布底色之上
    const bgHost = h('div', { id: 'margin-bg' });
    const bgRoot = bgHost.attachShadow({ mode: 'open' });
    bgRoot.append(h('style', {}, css));
    this.bgApp = h('div', { class: 'app bgwrap' }, this.bg.el);
    bgRoot.append(this.bgApp);
    de.append(bgHost);

    this.host = h('div', { id: 'margin-watch-top' });
    const root = this.host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, css));
    // 搜索页本身有大号搜索框，顶栏那个就不再重复（Ctrl+K / / 仍可唤出命令面板）
    if (kind === 'search') root.append(h('style', {}, '.top .search { visibility: hidden; pointer-events: none; }'));

    this.panel = createSettingsPanel(() => this.settings, () => this.bg.shader);
    this.fav = createFavorites((g) => attachPreview(g, () => this.settings.hoverPreview));
    const open = (u: string) => window.open(u, '_blank', 'noopener');
    const clickSel = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.click();
    const later = createLaterDrawer(() => this.app);
    const watchCmds: Command[] = isWatch ? [
      { id: 'w-top', title: '回到顶部', cat: '操作', icon: ICONS.top, run: () => scrollTo({ top: 0, behavior: 'smooth' }) },
      { id: 'w-comments', title: '看评论', cat: '跳转', icon: ICONS.message, keys: ['评论'], run: () => document.querySelector('#commentapp, bili-comments, .comment-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      { id: 'w-web', title: '网页全屏', cat: '操作', icon: ICONS.image, keys: ['全屏'], run: () => clickSel('.bpx-player-ctrl-web') },
      { id: 'w-wide', title: '宽屏模式', cat: '操作', icon: ICONS.image, keys: ['宽屏'], run: () => clickSel('.bpx-player-ctrl-wide') },
      { id: 'w-later', title: '把这个视频加入稍后再看', cat: '操作', icon: ICONS.later, keys: ['稍后'], run: async () => { const bv = location.pathname.match(/BV\w+/)?.[0]; if (!bv) return; const r = await addWatchLater(bv); toast(this.app, r.msg, r.ok ? { label: '查看', run: () => later.open() } : undefined); } },
      { id: 'w-copy', title: '复制视频链接', cat: '操作', icon: ICONS.link, keys: ['分享'], run: () => navigator.clipboard.writeText(location.href.split('?')[0]).then(() => toast(this.app, '链接已复制')) },
    ] : [{ id: 'w-top', title: '回到顶部', cat: '操作', icon: ICONS.top, run: () => scrollTo({ top: 0, behavior: 'smooth' }) }];
    const palette = createCommandPalette([
      ...watchCmds,
      { id: 'fav', title: '打开收藏夹', cat: '操作', icon: ICONS.fav, keys: ['收藏'], run: () => this.fav.open() },
      { id: 'theme', title: '切换亮色 / 暗色', cat: '操作', icon: ICONS.moon, keys: ['主题', '夜间'], run: () => this.toggleTheme() },
      { id: 'settings', title: '打开设置', cat: '操作', icon: ICONS.gear, run: () => this.panel.sheet.open() },
      { id: 'home', title: '回首页', cat: '跳转', icon: ICONS.logo, run: () => { location.href = 'https://www.bilibili.com/'; } },
      { id: 'later', title: '稍后再看', cat: '跳转', icon: ICONS.later, keys: ['watchlater'], run: () => later.open() },
      { id: 'history', title: '观看历史', cat: '跳转', icon: ICONS.history, run: () => open('https://www.bilibili.com/history') },
      { id: 'off', title: '本次回到 B 站原版', cat: '操作', icon: ICONS.exit, keys: ['原版'], run: () => { sessionStorage.setItem('biliprism:off', '1'); location.reload(); } },
    ]);
    const cm = createContextMenu();
    this.head = createHeader({
      onTheme: () => this.toggleTheme(),
      onSearch: (q) => palette.open(q),
      tabs: [
        ...SITE_LINKS,
        'separator',
        { title: '收藏', icon: ICONS.fav, run: () => this.fav.open() },
        { title: '稍后', icon: ICONS.later, run: () => later.open() },
        { title: '设置', icon: ICONS.gear, run: () => this.panel.sheet.open() },
        { title: '原版', icon: ICONS.exit, run: () => { sessionStorage.setItem('biliprism:off', '1'); location.reload(); } },
      ],
    });
    const click = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.click();
    const quick = isWatch ? createFloatingMenu([
      { label: '回到顶部', en: 'Back to Top', run: () => scrollTo({ top: 0, behavior: 'smooth' }) },
      { label: '看评论', en: 'Comments', run: () => document.querySelector('#commentapp, bili-comments, .comment-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      { label: '网页全屏', en: 'Web Fullscreen', run: () => click('.bpx-player-ctrl-web') },
      { label: '宽屏模式', en: 'Wide Mode', run: () => click('.bpx-player-ctrl-wide') },
      { label: '收藏夹', en: 'Favorites', run: () => this.fav.open() },
    ]) : null;
    this.app = h('div', { class: 'app wt', 'data-bg': 'off' }, this.head.el, quick?.el ?? null, createScrollRuler(), this.panel.sheet.el, this.fav.el, palette.el, later.el, cm.el);
    root.append(this.app);
    if (isWatch) skinComments();
    const lg = filtersIn(root);
    this.head.glass.forEach((g) => attachGlass(g, lg));
    attachGlass(this.head.thumb, lg, { blur: 2, strength: 0.4 });
    const favGrid = this.fav.el.querySelector('.fav-grid') as HTMLElement | null;
    if (favGrid) bindCardMenu(favGrid, cm, () => this.app, { onLater: () => later.open() });
    de.append(this.host);

    this.applyTheme(false);
    this.media.addEventListener('change', () => this.applyTheme(false));
    if (isWatch) { this.watchScreen(); startTriple(); podProgress(); }
  }

  update(s: Settings): void {
    const prev = this.settings;
    this.settings = s;
    if (prev.theme !== s.theme || JSON.stringify(prev.bg) !== JSON.stringify(s.bg)) this.applyTheme(false);
    this.panel.sync(s);
  }

  private resolved(): 'light' | 'dark' {
    const t = this.settings.theme;
    return t === 'auto' ? (this.media.matches ? 'dark' : 'light') : t;
  }

  private applyTheme(animate: boolean): void {
    const t = this.resolved();
    document.documentElement.dataset.marginTheme = t;
    this.app.dataset.theme = t;
    this.bgApp.dataset.theme = t;
    this.head.sunMoon.set(t, animate);
    const mode = this.settings.bg.mode;
    document.documentElement.classList.toggle('margin-has-bg', mode !== 'off');
    this.bg.apply(this.settings.bg, t, this.settings.palette).then(() => {
      document.documentElement.classList.toggle('margin-has-bg', this.bg.el.dataset.mode !== 'off');
      this.panel.sync(this.settings);
    });
  }

  private async toggleTheme(): Promise<void> {
    const next = this.resolved() === 'dark' ? 'light' : 'dark';
    this.settings = { ...this.settings, theme: next };
    this.applyTheme(true);
    await saveSettings({ theme: next });
  }

  /** 网页全屏 / 全屏时收起顶栏，不挡播放器 */
  private watchScreen(): void {
    const sync = () => {
      const p = document.querySelector('.bpx-player-container');
      const screen = p?.getAttribute('data-screen') ?? 'normal';
      const hide = screen === 'web' || screen === 'full' || !!document.fullscreenElement;
      this.host.toggleAttribute('hidden', hide);
      document.documentElement.classList.toggle('margin-webscreen', hide);
      wide(screen === 'wide');
    };
    // 宽屏：B 站把播放器拉满左右两栏，但右栏不会让位（原版靠被我们隐藏/重排掉的结构），这里把右栏推到播放器下面
    let ro: ResizeObserver | null = null;
    const de = document.documentElement;
    const place = () => {
      const pl = document.querySelector('.bpx-player-container'), rc = document.querySelector<HTMLElement>('.right-container');
      if (!pl || !rc) return;
      const prev = parseFloat(getComputedStyle(rc).paddingTop) || 0;
      const top = rc.getBoundingClientRect().top + prev;
      const pad = Math.max(0, Math.round(pl.getBoundingClientRect().bottom - (top - prev) + 24));
      de.style.setProperty('--m-wide-pad', `${pad}px`);
    };
    const wide = (on: boolean) => {
      de.classList.toggle('margin-wide', on);
      if (on) {
        requestAnimationFrame(place);
        if (!ro) { ro = new ResizeObserver(() => { if (de.classList.contains('margin-wide')) place(); }); }
        const pl = document.querySelector('.bpx-player-container');
        if (pl) ro.observe(pl);
      } else { ro?.disconnect(); de.style.removeProperty('--m-wide-pad'); }
    };
    new MutationObserver(sync).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-screen'] });
    document.addEventListener('fullscreenchange', sync);
    sync();
  }
}

/** 选集进度条：把「（3/14）」换算成 0–1 写到 .video-pod__header 的 --pod-p。
 *  只在切集时变，所以每 2 秒读一次那行文字（页面隐藏时不跑），不挂 MutationObserver。 */
function podProgress(): void {
  let last = '';
  every(2000, () => {
    const amt = document.querySelector<HTMLElement>('.video-pod__header .amt');
    const t = amt?.textContent ?? '';
    if (t === last) return;
    last = t;
    const m = t.match(/(\d+)\s*\/\s*(\d+)/);
    const head = amt?.closest<HTMLElement>('.video-pod__header');
    if (!head) return;
    if (m) head.style.setProperty('--pod-p', String(Math.min(1, +m[1] / Math.max(1, +m[2]))));
    else head.style.removeProperty('--pod-p');
  }, { immediate: true });
}
