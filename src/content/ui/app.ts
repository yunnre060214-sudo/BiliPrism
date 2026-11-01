import { popular, recommended, type Video } from '../api/feed';
import type { Settings } from '../../shared/settings';
import { saveSettings } from '../../shared/settings';
import { BackgroundLayer } from '../bg/background';
import { compileFilter, type Predicate } from '../filter';
import { videoCard, skeleton } from './card';
import { toast } from './controls';
import { h, icon, ICONS } from './dom';
import { createFavorites } from './favorites';
import { createHeader, SITE_LINKS } from './header';
import { shouldPlayIntro, setIntroActive } from './intro/gate';
import { createHeroSearch } from './hero-search';
import { createFootprintCard } from './footprint';
import { createWeather } from './weather';
import type { SunMoon } from './sun-moon';
import { attachPreview } from './preview';
import { createSettingsPanel, type SettingsPanel } from './settings-panel';
import type { Sheet } from './sheet';
import { attachGlass, filtersIn } from './liquid-glass';
import { createCommandPalette } from './command-palette';
import { createContextMenu } from './context-menu';
import { bindCardMenu } from './card-menu';
import { createLaterDrawer } from './drawer';
import css from '../styles.css?inline';

type Tab = 'rcmd' | 'popular';

export class MarginApp {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private app!: HTMLElement;
  private grid!: HTMLElement;
  private status!: HTMLElement;
  private sentinel!: HTMLElement;
  private sunMoon!: SunMoon;
  private fadeTimer = 0;
  private bg = new BackgroundLayer();
  private panel!: SettingsPanel;
  private fav!: Sheet;
  private foot!: HTMLElement;
  private dash!: HTMLElement;
  private wx: HTMLElement | null = null;
  private tab: Tab = 'rcmd';
  private round = 1;
  private page = 1;
  private loading = false;
  private done = false;
  private items: Video[] = [];
  private seen = new Set<string>();
  private keep: Predicate;
  private gen = 0;
  private media = matchMedia('(prefers-color-scheme: dark)');

  constructor(private settings: Settings) {
    this.keep = compileFilter(settings.filters);
    this.host = h('div', { id: 'margin-root' });
    this.root = this.host.attachShadow({ mode: 'open' });
    this.root.append(h('style', {}, css));
    this.render();
    this.applyTheme();
    this.media.addEventListener('change', () => this.applyTheme());
  }

  update(s: Settings): void {
    const prev = this.settings;
    this.settings = s;
    if (JSON.stringify(prev.filters) !== JSON.stringify(s.filters)) {
      this.keep = compileFilter(s.filters);
      this.repaint();
    }
    if (prev.footprint !== s.footprint || prev.weather !== s.weather) this.syncDash();
    if (prev.theme !== s.theme || prev.palette !== s.palette || JSON.stringify(prev.bg) !== JSON.stringify(s.bg)) this.applyTheme();
    this.panel.sync(s);
  }

  private resolvedTheme(): 'light' | 'dark' {
    const t = this.settings.theme;
    return t === 'auto' ? (this.media.matches ? 'dark' : 'light') : t;
  }

  private applyTheme(): void {
    const t = this.resolvedTheme();
    this.app.dataset.theme = t;
    this.app.dataset.palette = this.settings.palette;
    this.app.dataset.bg = this.settings.bg.mode;
    this.sunMoon.set(t);
    this.bg.apply(this.settings.bg, t, this.settings.palette).then(() => this.panel?.sync(this.settings));
  }

  /** 首页顶部的足迹 / 天气：按设置显示；天气卡第一次打开时才创建（关着就不请求天气） */
  private syncDash(): void {
    const s = this.settings;
    if (s.footprint) { if (!this.foot.isConnected) this.dash.prepend(this.foot); } else this.foot.remove();
    if (s.weather) { this.wx ??= createWeather(); if (!this.wx.isConnected) this.dash.append(this.wx); } else this.wx?.remove();
    this.dash.hidden = !s.footprint && !s.weather;
  }

  private showFoot(): void {
    if (!this.settings.footprint) { toast(this.app, '足迹热力图已关闭', { label: '打开', run: () => saveSettings({ footprint: true }) }); return; }
    this.app.scrollTo({ top: 0, behavior: 'smooth' });
    this.foot.animate([{ boxShadow: '0 0 0 2px var(--accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200, easing: 'ease-out' });
  }

  private render(): void {
    this.panel = createSettingsPanel(() => this.settings, () => this.bg.shader);
    this.fav = createFavorites((g) => attachPreview(g, () => this.settings.hoverPreview), () => this.settings.favDirect);
    this.foot = createFootprintCard();
    this.dash = h('div', { class: 'dash' });
    this.syncDash();
    // v0.20：足迹卡片改用 21st Glass Calendar 的 CSS 玻璃，不再走 GL 折射透镜
    const later = createLaterDrawer(() => this.app);
    const palette = createCommandPalette([
      { id: 'refresh', title: '换一批推荐', cat: '操作', icon: ICONS.refresh, keys: ['刷新', 'refresh'], run: () => this.reload() },
      { id: 'rcmd', title: '看推荐', cat: '跳转', icon: ICONS.moments, keys: ['首页'], run: () => (this.app.querySelector('.tab[data-tab=rcmd]') as HTMLElement)?.click() },
      { id: 'popular', title: '看热门', cat: '跳转', icon: ICONS.heat, keys: ['popular', '排行'], run: () => (this.app.querySelector('.tab[data-tab=popular]') as HTMLElement)?.click() },
      { id: 'fav', title: '打开收藏夹', cat: '操作', icon: ICONS.fav, keys: ['收藏'], run: () => this.fav.open() },
      { id: 'foot', title: '看足迹', desc: '一年的 B 站热力图', cat: '跳转', icon: ICONS.heat, keys: ['热力图', '足迹'], run: () => this.showFoot() },
      { id: 'theme', title: '切换亮色 / 暗色', cat: '操作', icon: ICONS.moon, keys: ['主题', '夜间', 'dark', 'light'], run: () => this.toggleTheme() },
      { id: 'settings', title: '打开设置', cat: '操作', icon: ICONS.gear, keys: ['背景', '过滤', '屏蔽'], run: () => this.panel.sheet.open() },
      { id: 'top', title: '回到顶部', cat: '操作', icon: ICONS.top, run: () => this.app.scrollTo({ top: 0, behavior: 'smooth' }) },
      { id: 'later', title: '稍后再看', cat: '跳转', icon: ICONS.later, keys: ['watchlater'], run: () => later.open() },
      { id: 'moments', title: '动态', cat: '跳转', icon: ICONS.moments, run: () => window.open('https://t.bilibili.com/', '_blank', 'noopener') },
      { id: 'live', title: '直播', cat: '跳转', icon: ICONS.live, keys: ['live', 'zhibo'], run: () => window.open('https://live.bilibili.com/', '_blank', 'noopener') },
      { id: 'message', title: '消息', cat: '跳转', icon: ICONS.message, run: () => window.open('https://message.bilibili.com/', '_blank', 'noopener') },
      { id: 'history', title: '观看历史', cat: '跳转', icon: ICONS.history, run: () => window.open('https://www.bilibili.com/history', '_blank', 'noopener') },
      { id: 'off', title: '本次回到 B 站原版', cat: '操作', icon: ICONS.exit, keys: ['原版', '关闭'], run: () => { sessionStorage.setItem('biliprism:off', '1'); location.reload(); } },
    ]);
    const cm = createContextMenu();
    const head = createHeader({ onTheme: () => this.toggleTheme(), onSearch: (q) => palette.open(q), tabs: [
      ...SITE_LINKS,
      'separator',
      { title: '收藏', icon: ICONS.fav, run: () => this.fav.open() },
      { title: '稍后', icon: ICONS.later, run: () => later.open() },
      { title: '足迹', icon: ICONS.heat, run: () => this.showFoot() },
      { title: '设置', icon: ICONS.gear, run: () => this.panel.sheet.open() },
    ] });
    this.sunMoon = head.sunMoon;
    const header = head.el;

    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const mkTab = (id: Tab, label: string) => {
      const b = h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(id === this.tab), onclick: () => this.switchTab(id, tabs) }, label);
      b.dataset.tab = id;
      return b;
    };
    tabs.append(mkTab('rcmd', '推荐'), mkTab('popular', '热门'));
    const refresh = h('button', { class: 'ghost refresh', type: 'button', title: '换一批', onclick: () => this.reload() }, icon(ICONS.refresh), h('span', {}, '换一批'));

    // 吸顶时分类栏变成液态玻璃胶囊，日期行收起
    head.el.classList.add('no-search');
    const barMark = h('div', { class: 'bar-mark', 'aria-hidden': 'true' });
    // 首页主搜索：居中大胶囊（和搜索页同款），顶栏的小搜索框在首页隐藏，避免两个入口
    const heroS = createHeroSearch(() => this.app);
    const hero = heroS.el;
    // 汇流背景的点线汇向首页搜索栏
    this.bg.setFocus(hero);
    const bar = h('div', { class: 'bar' }, h('div', { class: 'eyebrow' }, h('span', {}, todayLabel()), h('span', { class: 'en' }, 'For You'), h('span', { class: 'no' }, issueNo())), h('div', { class: 'bar-row' }, tabs, refresh));

    this.grid = h('section', { class: 'grid', 'aria-live': 'polite' });
    this.status = h('div', { class: 'status' });
    this.sentinel = h('div', { class: 'sentinel' });
    attachPreview(this.grid, () => this.settings.hoverPreview);

    const exit = h('button', {
      class: 'ghost small', type: 'button', onclick: () => { sessionStorage.setItem('biliprism:off', '1'); location.reload(); },
    }, icon(ICONS.exit), h('span', {}, '本次回到 B 站原版首页'));

    this.app = h('div', { class: 'app home' },
      this.bg.el,
      header,
      h('main', { class: 'main' },
        heroS.scrim,
        hero,
        this.dash,
        barMark,
        bar,
        this.grid, this.status, this.sentinel,
        h('footer', { class: 'foot' }, exit, h('span', {}, '映棱 BiliPrism · 非 B 站官方')),
      ),
      this.panel.sheet.el,
      this.fav.el,
      palette.el,
      later.el,
      cm.el,
    );
    this.root.append(this.app);
    if (shouldPlayIntro(this.settings.intro)) {
      // 开场引擎（WebGL，约 37KB）按需加载；加载前先用同色底板盖住首页，避免闪一下
      const theme = this.resolvedTheme();
      const cover = h('div', { class: 'intro', role: 'presentation', style: `background:${theme === 'dark' ? '#111112' : '#f5f4f1'}` });
      this.app.append(cover);
      setIntroActive(true);
      import('./intro/intro').then((m) => { void m.playIntro(this.app, theme); requestAnimationFrame(() => cover.remove()); })
        .catch((e) => { console.error('[BiliPrism] intro', e); cover.remove(); setIntroActive(false); });
    }
    let scrollT = 0;
    this.app.addEventListener('scroll', () => {
      this.bg.redraw();
      if (!scrollT) this.app.classList.add('scrolling');
      clearTimeout(scrollT);
      scrollT = window.setTimeout(() => { scrollT = 0; this.app.classList.remove('scrolling'); this.fillIfShort(); }, 160);
    }, { passive: true });
    const lg = filtersIn(this.root);
    head.glass.forEach((g) => attachGlass(g, lg));
    attachGlass(head.thumb, lg, { blur: 2, strength: 0.4 });
    attachGlass(tabs, lg); attachGlass(refresh, lg);
    bindCardMenu(this.grid, cm, () => this.app, { onBlock: (x) => this.blockUp(x), onLater: () => later.open() });
    const favGrid = this.fav.el.querySelector('.fav-grid') as HTMLElement | null;
    if (favGrid) bindCardMenu(favGrid, cm, () => this.app, { onLater: () => later.open() });
    new IntersectionObserver(([e]) => {
      bar.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < 80);
    }, { root: this.app, rootMargin: '-72px 0px 0px 0px', threshold: 0 }).observe(barMark);

    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) this.load(); }, { root: this.app, rootMargin: '900px 0px' }).observe(this.sentinel);
    // 从个人空间等页面的入口跳回首页时直接打开对应面板：bilibili.com/#fav、#later
    const hashOpen = () => {
      const k = location.hash.slice(1);
      if (k !== 'fav' && k !== 'later') return;
      history.replaceState(null, '', location.pathname + location.search);
      if (k === 'fav') this.fav.open(); else later.open();
    };
    hashOpen();
    addEventListener('hashchange', hashOpen);

    this.load();
  }

  private async toggleTheme(): Promise<void> {
    const next = this.resolvedTheme() === 'dark' ? 'light' : 'dark';
    // 页面颜色和日月动画用同一时长淡入淡出（替代原来的 View Transition 圆形揭幕，它会冻结按钮动画）
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.app.classList.add('theme-fading');
      this.app.style.setProperty('--fade', `${this.sunMoon.duration}ms`);
      clearTimeout(this.fadeTimer);
      this.fadeTimer = window.setTimeout(() => this.app.classList.remove('theme-fading'), this.sunMoon.duration + 100);
    }
    this.settings = { ...this.settings, theme: next };
    this.applyTheme();
    await saveSettings({ theme: next });
  }

  private switchTab(id: Tab, tabs: HTMLElement): void {
    if (id === this.tab) return;
    this.tab = id;
    tabs.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    this.reload();
  }

  private reload(): void {
    this.gen++;
    this.grid.replaceChildren();
    this.items = [];
    this.seen.clear();
    this.done = false;
    this.loading = false;
    this.page = 1;
    this.round++;
    this.app.scrollTo({ top: 0 });
    this.load();
  }

  /** 过滤条件变化后，用已加载的数据重画网格 */
  private repaint(): void {
    const shown = this.items.filter(this.keep);
    this.grid.replaceChildren(...shown.map((v, i) => videoCard(v, i, { onBlock: (x) => this.blockUp(x) })));
    this.grid.querySelectorAll('.card').forEach((c) => c.classList.add('still'));
    this.fillIfShort();
  }

  private async blockUp(v: Video): Promise<void> {
    const before = this.settings.filters.ups;
    if (before.includes(v.author) || before.includes(String(v.mid))) return;
    await saveSettings({ filters: { ...this.settings.filters, ups: [...before, v.author] } });
    toast(this.app, `已屏蔽「${v.author}」`, { label: '撤销', run: () => saveSettings({ filters: { ...this.settings.filters, ups: this.settings.filters.ups.filter((u) => u !== v.author) } }) });
  }

  /** IntersectionObserver 只在「进入 / 离开」时触发：加载完哨兵还停在可视范围里、或被过滤掉一整批时不会再响，
   *  所以加载结束和滚动停下后都按滚动容器的剩余高度再查一次（用户反馈：滚到底有概率不再刷新） */
  private fillIfShort(): void {
    if (this.done || this.loading || !this.sentinel.isConnected) return;
    const a = this.app;
    const left = a.scrollHeight - a.scrollTop - a.clientHeight;
    const r = this.sentinel.getBoundingClientRect();
    if (left < 1200 || r.top < innerHeight + 900) this.load();
  }

  private async load(attempt = 0): Promise<void> {
    if (this.loading || this.done) return;
    this.loading = true;
    const gen = this.gen;
    const sk = skeleton(this.grid.children.length ? 4 : 12);
    const skNodes = [...sk.childNodes];
    this.grid.append(sk);
    this.status.replaceChildren();
    let added = 0;
    try {
      let list: Video[];
      if (this.tab === 'rcmd') {
        const batches = await Promise.all([recommended(this.round), recommended(this.round + 1)]);
        this.round += 2;
        list = batches.flat();
      } else {
        const r = await popular(this.page++);
        list = r.list;
        this.done = r.done;
      }
      if (gen !== this.gen) return;
      skNodes.forEach((n) => (n as Element).remove());
      const start = this.grid.children.length;
      for (const v of list) {
        if (this.seen.has(v.bvid)) continue;
        this.seen.add(v.bvid);
        this.items.push(v);
        if (!this.keep(v)) continue;
        this.grid.append(videoCard(v, start + added++, { onBlock: (x) => this.blockUp(x) }));
      }
      if (this.done) this.status.replaceChildren(h('span', {}, '没有更多了'));
    } catch (err) {
      if (gen !== this.gen) return;
      skNodes.forEach((n) => (n as Element).remove());
      // 推荐接口偶发风控 / 超时：先静默重试两次，再给出重试按钮
      if (attempt < 2) { this.loading = false; window.setTimeout(() => { if (gen === this.gen) this.load(attempt + 1); }, 800 * (attempt + 1)); return; }
      this.status.replaceChildren(h('span', {}, `加载失败：${(err as Error).message}`), h('button', { class: 'ghost small', type: 'button', onclick: () => this.load() }, '重试'));
      return;
    } finally {
      if (gen === this.gen) this.loading = false;
    }
    // 被过滤掉太多时自动补一批
    if (gen === this.gen && added < 6 && attempt < 4) this.load(attempt + 1);
    else if (gen === this.gen) {
      requestAnimationFrame(() => this.fillIfShort());
      // 连续几批都被过滤或重复：稍等再补，不让列表停在底部
      if (added === 0) window.setTimeout(() => { if (gen === this.gen) this.fillIfShort(); }, 1500);
    }
  }
}

/** 杂志刊号式的眉标：一年中的第几天 */
function issueNo(): string {
  const d = new Date(), y = new Date(d.getFullYear(), 0, 0);
  return `NO. ${String(Math.floor((d.getTime() - y.getTime()) / 864e5)).padStart(3, '0')}`;
}

function todayLabel(): string {
  const d = new Date();
  const w = '日一二三四五六'[d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${w}`;
}
