// Adapted to BewlyCat Moments layout, component controls, wanted/pinned users and filters.
import type { Settings } from '../../shared/settings';
import { nav } from '../api/http';
import { account, accountStat } from '../api/account';
import { followFeed, portal, type FeedType, type LiveUp, type Up, type Dyn } from '../api/dyn';
import { hotSearch } from '../api/search';
import { dynCard } from './dyn';
import { fmtCount, h, icon, ICONS } from './dom';
import { PageShell } from './shell';
import { allowMoment, matchesUser, sortUps } from '../moments/filter';
import { saveSettings } from '../../shared/settings';
import momentsCss from '../moments/moments.css?inline';

const TYPES: [FeedType, string][] = [['all', '全部'], ['video', '视频投稿'], ['pgc', '追番追剧'], ['article', '专栏']];
const ext = { target: '_blank', rel: 'noopener' };
const face = (src: string, cls: string, w = 96) => h('img', { class: cls, src: src ? `${src}@${w}w_${w}h_1c.webp` : '', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });

/** BewlyCat Moments layout and configurable feed, integrated with BiliPrism's shell. */
export class FeedApp {
  readonly shell: PageShell;
  private type: FeedType;
  private host = 0;
  private offset = '';
  private done = false;
  private loading = false;
  private gen = 0;
  private list!: HTMLElement;
  private status!: HTMLElement;
  private sentinel!: HTMLElement;
  private strip!: HTMLElement;
  private tabs!: HTMLElement;
  private layout!: HTMLElement;
  private more!: HTMLButtonElement;
  private wantedButton!: HTMLButtonElement;
  private wantedOnly = false;
  private ups: Up[] = [];
  private items: Dyn[] = [];
  private ready = false;
  private failed = false;

  constructor(settings: Settings) {
    this.shell = new PageShell(settings, 'feed');
    this.shell.root.append(h('style', {}, momentsCss));
    document.title = '动态 · 映棱';
    const t = new URLSearchParams(location.search).get('tab');
    this.type = t === 'video' || t === 'pgc' || t === 'article' ? t : 'all';
    this.render();
  }

  update(s: Settings): void {
    const changed = JSON.stringify(s.moments) !== JSON.stringify(this.shell.settings.moments);
    this.shell.update(s);
    this.applyLayout();
    if (changed) { this.renderUps(this.ups); this.paintCards(); requestAnimationFrame(() => this.fill()); }
  }

  private applyLayout(): void {
    const c = this.shell.settings.moments;
    for (const [k,v] of Object.entries(c)) if (typeof v === 'boolean' || typeof v === 'number')
      this.layout.dataset[k] = String(v);
    this.layout.dataset.left = String(c.showProfile || c.showLive);
    this.layout.dataset.right = String(c.showHot);
    this.layout.style.setProperty('--moments-columns', String(c.columns));
    this.applyLinks(this.layout);
  }
  private applyLinks(root: HTMLElement): void {
    root.querySelectorAll<HTMLAnchorElement>('a').forEach(a => {
      a.target = this.shell.settings.moments.openInNewTab ? '_blank' : '_self'; a.rel='noopener';
    });
  }
  private paintCards(): void {
    const c = this.shell.settings.moments;
    const shown = this.items.filter(d => allowMoment(d,c,this.wantedOnly));
    this.list.replaceChildren(...shown.map(d => {
      const card=dynCard(d,false,true);card.classList.add('moment-card');card.dataset.id=d.id;
      const text=card.querySelector<HTMLElement>('.dy-text');
      if(text && d.text.length>120){
        const expand=h('button',{class:'moment-text-more',type:'button','aria-expanded':'false',onclick:()=>{
          const on=expand.getAttribute('aria-expanded')!=='true';expand.setAttribute('aria-expanded',String(on));card.dataset.textExpanded=String(on);expand.textContent=on?'收起正文':'展开正文';
        }},'展开正文');text.after(expand);
      }
      const stats=card.querySelector('.dy-stat');
      const comments=stats?.children[1];
      if(comments){const link=h('a',{href:`https://t.bilibili.com/${d.id}`,title:'查看动态评论'},comments.textContent??'评论');comments.replaceWith(link);}
      const actions=h('details',{class:'moment-actions'},h('summary',{'aria-label':`${d.author} 的动态选项`},'⋯'));
      const act=(label:string,key:'wantedUsers'|'pinnedUsers'|'blockedUsers')=>h('button',{type:'button',onclick:()=>{
        const old=this.shell.settings.moments[key],has=matchesUser(old,d.mid,d.author);
        const next=has?old.filter(v=>!matchesUser([v],d.mid,d.author)):[...old,String(d.mid)];
        void saveSettings({moments:{...this.shell.settings.moments,[key]:next}});
      }},label);
      const by=card.querySelector('.dy-by');
      by?.append(actions);
      actions.append(act(matchesUser(c.wantedUsers,d.mid,d.author)?'取消特别关注':'加入特别关注','wantedUsers'),
        act(matchesUser(c.pinnedUsers,d.mid,d.author)?'取消置顶 UP 主':'置顶 UP 主','pinnedUsers'),act('屏蔽该 UP 主','blockedUsers'));
      return card;
    }));
    if (!shown.length && !this.loading) this.list.append(h('div',{class:'ms-empty'},h('p',{},this.wantedOnly && !c.wantedUsers.length ? '在设置或动态卡片菜单中添加特别关注 UP 主' : this.items.length ? '当前动态均被筛选条件隐藏' : '这里还空着')));
    this.applyLinks(this.list);
  }

  private render(): void {
    const s = this.shell;
    const left = h('aside', { class: 'fd-side fd-left' });
    const right = h('aside', { class: 'fd-side fd-right' });
    this.strip = h('div', { class: 'fd-ups' });
    this.tabs = h('div', { class: 'tabs fd-tabs', role: 'tablist' }, ...TYPES.map(([id, label]) => {
      const b = h('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(id === this.type), onclick: () => this.setType(id) }, label);
      b.dataset.tab = id;
      return b;
    }));
    const post = h('a', { class: 'fd-post', href: 'https://t.bilibili.com/?biliprism=off', title: '在 B 站原版里发动态' }, icon('<path d="M12 5v14M5 12h14"/>'), h('span', {}, '发动态'));
    this.list = h('div', { class: 'dy-list fd-list moments-grid' });
    this.status = h('div', { class: 'status' });
    this.sentinel = h('div', { class: 'sentinel' });
    this.more = h('button',{type:'button',class:'ghost moment-more',onclick:()=>this.load()},'加载更多');
    this.wantedButton=h('button',{type:'button',class:'ghost small', 'aria-pressed':'false',onclick:()=>{
      this.wantedOnly=!this.wantedOnly;this.host=0;
      this.wantedButton.setAttribute('aria-pressed',String(this.wantedOnly));this.renderUps(this.ups);this.paintCards();this.fill();
    }},'特别关注');
    const refresh=h('button',{type:'button',class:'ghost small','aria-label':'刷新动态',onclick:()=>this.reload()},'刷新');
    const center = h('section', { class: 'fd-main' },
      h('header', { class: 'fd-head' },
        h('h1', { class: 'fd-h1' }, '动态'),
        h('div',{class:'moment-head-actions'},this.wantedButton,refresh,post)),
      this.strip,
      h('div', { class: 'bar-row fd-bar' }, this.tabs),
      this.list, this.status, this.more, this.sentinel);
    this.layout=h('div', { class: 'fd moments-layout' }, left, center, right);
    s.main.append(this.layout);this.applyLayout();
    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) this.fill(); }, { root: s.app, rootMargin: '1200px 0px' }).observe(this.sentinel);
    let st = 0;
    s.app.addEventListener('scroll', () => { clearTimeout(st); st = window.setTimeout(() => this.fill(), 160); }, { passive: true });

    void this.renderHot(right).catch(()=>{right.textContent='热搜暂时不可用';});
    nav().then((n) => {
      if (!n?.isLogin) {
        this.done = true;this.more.hidden=true;
        left.remove();this.layout.dataset.left='false';
        this.list.replaceChildren(h('div', { class: 'ms-empty' }, h('p', {}, '登录后查看关注的人的动态'), h('a', { class: 'sp-follow', href: 'https://passport.bilibili.com/login', ...ext }, '去登录')));
        return;
      }
      void this.renderMe(left).catch(()=>{});
      this.ready=true;
      portal().then((p) => { this.renderUps(p.ups); this.renderLive(left, p.live, p.liveCount); }).catch(() => { /* 头像条可缺省 */ });
      this.load();
    }).catch(() => { this.ready=true;this.load(); });
  }

  private async renderMe(left: HTMLElement): Promise<void> {
    const card = h('section', { class: 'fd-card fd-me' }, h('div', { class: 'line' }), h('div', { class: 'line short' }));
    left.prepend(card);
    const [a, st] = await Promise.all([account(), accountStat().catch(() => null)]);
    if (!a) { card.remove(); return; }
    const space = `https://space.bilibili.com/${a.mid}`;
    const stat = (n: number | undefined, label: string, href: string) => h('a', { class: 'fd-stat', href, ...ext }, h('b', {}, n == null ? '—' : fmtCount(n)), h('span', {}, label));
    card.replaceChildren(
      h('a', { class: 'fd-me-id', href: space, ...ext },
        face(a.face, 'fd-me-face', 112),
        h('span', { class: 'fd-me-name' }, h('b', { style: a.vipColor ? `color:${a.vipColor}` : '' }, a.name), h('span', {}, h('i', { class: 'fd-lv' }, `LV${a.level}`), a.vipLabel ? h('i', { class: 'fd-vip' }, a.vipLabel) : null))),
      h('div', { class: 'fd-stats' },
        stat(st?.following, '关注', `${space}/relation/follow`),
        stat(st?.follower, '粉丝', `${space}/relation/fans`),
        stat(st?.dynamic, '动态', `${space}/dynamic`)));
    this.applyLinks(left);
  }

  private renderLive(left: HTMLElement, live: LiveUp[], count: number): void {
    if (!live.length) return;
    left.append(h('section', { class: 'fd-card fd-live' },
      h('div', { class: 'fd-card-h' }, h('span', {}, '正在直播'), h('b', {}, String(count))),
      ...live.slice(0, 10).map((u) => h('a', { class: 'fd-live-row', href: u.url, ...ext },
        h('span', { class: 'fd-live-face' }, face(u.face, '', 80)),
        h('span', { class: 'fd-live-b' }, h('b', {}, u.name), h('span', {}, u.title))))));
    this.applyLinks(left);
  }

  private renderUps(ups: Up[]): void {
    this.ups=ups;
    const mk = (mid: number, name: string, img: Node, fresh = false) => {
      const b = h('button', { class: 'fd-up', type: 'button', title: fresh ? `${name} · 有新动态` : name, 'aria-pressed': String(mid === this.host && !this.wantedOnly) }, h('span', { class: 'fd-up-face' }, img), h('span', { class: 'fd-up-name' }, name));
      b.dataset.mid = String(mid);
      if (fresh) b.classList.add('fresh');
      b.addEventListener('click', () => {
        this.host = this.host === mid ? 0 : mid;this.wantedOnly=false;this.wantedButton.setAttribute('aria-pressed','false');
        b.classList.remove('fresh');
        this.strip.querySelectorAll<HTMLElement>('.fd-up').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.mid) === this.host)));
        this.reload();
      });
      return b;
    };
    this.strip.replaceChildren(
      mk(0, '全部动态', h('span', { class: 'fd-up-all' }, icon(ICONS.moments))),
      ...sortUps(ups,this.shell.settings.moments.pinnedUsers).slice(0, 50).map((u) => {
        const b=mk(u.mid,u.name,face(u.face,'',96),u.fresh);
        if(matchesUser(this.shell.settings.moments.pinnedUsers,u.mid,u.name)) b.classList.add('pinned');
        return b;
      }));
  }

  private async renderHot(right: HTMLElement): Promise<void> {
    const box = h('section', { class: 'fd-card fd-hot' }, h('div', { class: 'fd-card-h' }, h('span', {}, '热搜'), h('b', {}, 'TRENDING')));
    right.append(box);
    const list = await hotSearch();
    if (!list.length) { box.remove(); return; }
    box.append(h('ol', { class: 'fd-hot-list' }, ...list.slice(0, 10).map((x, i) =>
      h('li', {}, h('a', { href: `https://search.bilibili.com/all?keyword=${encodeURIComponent(x.keyword)}`, ...ext }, h('i', { class: i < 3 ? 'hot' : '' }, String(i + 1).padStart(2, '0')), h('span', {}, x.name))))));
    this.applyLinks(right);
  }

  private setType(t: FeedType): void {
    if (t === this.type) return;
    this.type = t;
    this.tabs.querySelectorAll<HTMLElement>('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    const u = new URL(location.href);
    if (t === 'all') u.searchParams.delete('tab'); else u.searchParams.set('tab', t);
    history.replaceState(null, '', u);
    this.reload();
  }

  private reload(): void {
    this.gen++;
    this.offset = ''; this.done = false; this.loading = false;this.failed=false;this.items=[];
    this.list.replaceChildren();
    this.status.textContent = '';
    this.load();
  }

  private async load(): Promise<void> {
    if (!this.ready || this.loading || this.done) return;
    this.loading = true;this.failed=false;this.more.disabled=true;this.more.textContent='正在加载…';
    const gen = this.gen;
    const sk = Array.from({ length: this.offset ? 1 : 3 }, () => h('article', { class: 'dy sk' }, h('div', { class: 'line short' }), h('div', { class: 'line' }), h('div', { class: 'line' })));
    this.list.append(...sk);
    try {
      const r = await followFeed(this.host ? 'all' : this.type, this.offset, this.host);
      if (gen !== this.gen) return;
      sk.forEach((n) => n.remove());
      const known=new Set(this.items.map(d=>d.id));
      this.items.push(...r.list.filter(d=>!known.has(d.id)));
      this.paintCards();
      this.done = !r.more || !r.offset || r.offset===this.offset;
      this.offset = r.offset;
      if (!this.list.children.length) this.list.append(h('div', { class: 'ms-empty' }, h('p', {}, '这里还空着')));
      else if (this.done) this.status.textContent = '— 到底了 —';
    } catch (e) {
      if (gen !== this.gen) return;
      sk.forEach((n) => n.remove());
      this.failed = true;
      this.status.textContent = `加载失败：${(e as Error).message}`;
    } finally {
      if (gen === this.gen) {this.loading = false;this.more.disabled=false;this.more.hidden=this.done;this.more.textContent=this.failed?'重试加载':'加载更多';if(!this.failed)this.paintCards();}
    }
    if (gen === this.gen) requestAnimationFrame(() => this.fill());
  }

  /** 哨兵加载完仍在视口附近时 IntersectionObserver 不会再触发，按剩余高度补查 */
  private fill(): void {
    if (!this.shell.settings.moments.autoLoad || this.failed || this.done || this.loading) return;
    const a = this.shell.app;
    if (a.scrollHeight - a.scrollTop - a.clientHeight < 1400) this.load();
  }
}
