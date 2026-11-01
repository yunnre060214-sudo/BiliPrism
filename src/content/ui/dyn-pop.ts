import { followFeed, portal, type Dyn } from '../api/dyn';
import { historyList } from '../api/history';
import { folders } from '../api/fav';
import { watchLater } from '../api/search';
import { unread } from '../api/msg';
import { h } from './dom';

/** 悬停多久才弹出：只是路过顶栏时不打扰 */
const OPEN_DELAY = 1500;
const CLOSE_DELAY = 220;

/** 列表里的一行：头像或封面 + 两行文字，或一个计数 */
export interface PopRow { href: string; face?: string; title: string; who?: string; sub?: string; cover?: string; progress?: number; count?: number; live?: boolean }
export interface PopSpec {
  title: string;
  all: { href: string; label: string };
  /** null = 未登录 */
  load: () => Promise<PopRow[] | null>;
  empty: string;
  onOpen?: () => void;
  /** 每行只有一行文字的紧凑样式（消息分类） */
  compact?: boolean;
}

export function ago(ts: number, fallback = ''): string {
  if (!ts) return fallback;
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`;
  const d = new Date(ts * 1000);
  return fallback || `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const thumb = (src: string, w: number, hh: number) => (src ? `${src}@${w}w_${hh}h_1c.webp` : '');
const img = (src: string, cls: string, w: number, hh = w) =>
  h('img', { class: cls, src: thumb(src, w, hh), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });

function row(r: PopRow): HTMLElement {
  const cover = r.cover !== undefined
    ? h('span', { class: 'dp-cover' }, r.cover ? img(r.cover, '', 128, 72) : '', r.progress !== undefined ? h('i', { class: 'dp-prog', style: `--p:${Math.max(0, Math.min(1, r.progress))}` }) : '')
    : null;
  return h('a', { class: 'dp-row', href: r.href, target: '_blank', rel: 'noopener' },
    r.face !== undefined ? h('span', { class: 'dp-face' + (r.live ? ' live' : '') }, r.face ? img(r.face, '', 64) : '') : '',
    h('div', { class: 'dp-body' },
      r.who || r.sub ? h('div', { class: 'dp-meta' }, r.who ? h('b', {}, r.who) : '', r.sub ? h('span', {}, r.sub) : '') : '',
      h('p', { class: 'dp-line' }, r.title)),
    r.count !== undefined ? h('em', { class: r.count ? 'dp-count' : 'dp-count zero' }, r.count > 99 ? '99+' : String(r.count)) : '',
    cover);
}

/**
 * 顶栏入口的悬停列表：指针在按钮上停满 1.5 秒才弹出，
 * 移进面板可继续浏览，离开后稍等再收起；Esc 或点按钮本身也会收起。
 */
export function attachHoverList(btn: HTMLElement, spec: PopSpec): void {
  const pop = h('div', { class: 'dp' + (spec.compact ? ' compact' : ''), role: 'dialog', 'aria-label': spec.title, hidden: '' });
  const list = h('div', { class: 'dp-list' });
  pop.append(
    h('div', { class: 'dp-head' }, h('span', {}, spec.title), h('a', { href: spec.all.href, target: '_blank', rel: 'noopener' }, `${spec.all.label} →`)),
    list,
  );
  let openT = 0, closeT = 0, loadedAt = 0, open = false;

  const load = () => {
    if (Date.now() - loadedAt < 60_000 && list.querySelector('.dp-row')) return;
    loadedAt = Date.now();
    list.replaceChildren(...Array.from({ length: spec.compact ? 5 : 4 }, () => h('div', { class: 'dp-skel' })));
    spec.load().then((rows) => {
      if (rows === null) { loadedAt = 0; list.replaceChildren(h('p', { class: 'dp-empty' }, `登录后可在这里看到${spec.title}`)); return; }
      list.replaceChildren(...(rows.length ? rows.map(row) : [h('p', { class: 'dp-empty' }, spec.empty)]));
    }).catch(() => {
      loadedAt = 0;
      list.replaceChildren(h('p', { class: 'dp-empty' }, '暂时没取到，稍后再试'));
    });
  };

  const place = () => {
    // 挂在顶栏里（顶栏 z-index 高于正文），按顶栏坐标定位
    const host = pop.parentElement ?? btn;
    const r = btn.getBoundingClientRect(), o = host.getBoundingClientRect();
    const w = pop.offsetWidth || 360;
    const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
    pop.style.left = `${left - o.left}px`;
    pop.style.top = `${r.bottom - o.top + 10}px`;
  };

  const show = () => {
    if (open) return;
    open = true;
    // 同一时间只开一个
    pop.parentElement?.querySelectorAll<HTMLElement>('.dp[data-open]').forEach((p) => p !== pop && p.dispatchEvent(new Event('dp-close')));
    const host = btn.closest('header') ?? btn.parentElement!;
    if (pop.parentNode !== host) host.append(pop);
    host.querySelectorAll<HTMLElement>('.dp[data-open]').forEach((p) => p !== pop && p.dispatchEvent(new Event('dp-close')));
    pop.hidden = false;
    place(); load();
    void pop.offsetWidth; // 先让 hidden→显示生效，再触发过渡
    pop.setAttribute('data-open', '');
    btn.setAttribute('aria-expanded', 'true');
    spec.onOpen?.();
  };
  const hide = () => {
    if (!open) return;
    open = false;
    pop.removeAttribute('data-open');
    btn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!open) pop.hidden = true; }, 200);
  };
  pop.addEventListener('dp-close', hide);

  const enter = (e: Event) => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    clearTimeout(closeT);
    if (!open) { clearTimeout(openT); openT = window.setTimeout(show, OPEN_DELAY); }
  };
  const leave = () => { clearTimeout(openT); clearTimeout(closeT); closeT = window.setTimeout(hide, CLOSE_DELAY); };
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('pointerenter', enter);
  btn.addEventListener('pointerleave', leave);
  btn.addEventListener('click', () => { clearTimeout(openT); hide(); });
  pop.addEventListener('pointerenter', () => clearTimeout(closeT));
  pop.addEventListener('pointerleave', leave);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  addEventListener('resize', () => { if (open) place(); });
}

/* ---------- 各入口的数据 ---------- */

function dynSummary(d: Dyn): { line: string; cover: string; kind: string } {
  if (d.video) return { line: d.video.title, cover: d.video.cover, kind: '视频' };
  if (d.article) return { line: d.article.title, cover: d.article.cover, kind: '专栏' };
  const o = d.orig;
  if (o && !d.text) {
    const s = dynSummary(o);
    return { line: `转发 @${o.author}：${s.line}`, cover: s.cover, kind: '转发' };
  }
  return { line: d.title || d.text || '分享了动态', cover: d.pics[0] ?? '', kind: d.pics.length ? '图文' : '动态' };
}

const dur = (s: number) => { const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };

export const POPS: Record<string, (o: { onDyn?: () => void }) => PopSpec> = {
  直播: () => ({
    title: '正在直播', all: { href: 'https://link.bilibili.com/p/center/index#/user-center/follow/1', label: '我的关注' }, empty: '关注的主播都还没开播',
    load: async () => (await portal()).live.slice(0, 8).map((u) => ({ href: u.url, face: u.face, live: true, who: u.name, sub: '直播中', title: u.title || '正在直播' })),
  }),
  消息: () => ({
    title: '消息', all: { href: 'https://message.bilibili.com/', label: '消息中心' }, empty: '', compact: true,
    load: async () => {
      const u = await unread();
      const M = 'https://message.bilibili.com/#/';
      return [
        { href: `${M}reply`, title: '回复我的', count: u.reply },
        { href: `${M}at`, title: '@ 我的', count: u.at },
        { href: `${M}love`, title: '收到的赞', count: u.like },
        { href: `${M}system`, title: '系统通知', count: u.system },
        { href: `${M}whisper`, title: '我的消息', count: u.chat },
      ];
    },
  }),
  动态: (o) => ({
    title: '最新动态', all: { href: 'https://t.bilibili.com/', label: '全部动态' }, empty: '还没有新动态', onOpen: o.onDyn,
    load: async () => (await followFeed('all', '')).list.slice(0, 8).map((d) => {
      const s = dynSummary(d);
      return { href: d.url, face: d.face, who: d.author, sub: `${ago(d.ts, d.time)} · ${s.kind}`, title: s.line, cover: s.cover || undefined };
    }),
  }),
  历史: () => ({
    title: '最近看过', all: { href: 'https://www.bilibili.com/history', label: '全部历史' }, empty: '还没有观看记录',
    load: async () => (await historyList('all', null)).list.slice(0, 8).map((x) => ({
      href: x.url, title: x.title, who: x.author, sub: `${ago(x.viewAt)} · ${x.device}`, cover: x.cover,
      progress: x.duration > 0 ? (x.progress < 0 ? 1 : x.progress / x.duration) : undefined,
    })),
  }),
  收藏: () => ({
    title: '收藏夹', all: { href: 'https://www.bilibili.com/#fav', label: '全部收藏' }, empty: '还没有收藏夹',
    load: async () => {
      const f = await folders();
      return f && f.slice(0, 8).map((x) => ({ href: `https://space.bilibili.com/${x.mid}/favlist?fid=${x.id}`, title: x.title, sub: `${x.count} 个内容${x.isPrivate ? ' · 私密' : ''}`, cover: x.cover }));
    },
  }),
  稍后: () => ({
    title: '稍后再看', all: { href: 'https://www.bilibili.com/list/watchlater', label: '全部' }, empty: '稍后再看是空的',
    load: async () => {
      const l = await watchLater();
      return l && l.slice(0, 8).map((x) => ({
        href: `https://www.bilibili.com/list/watchlater?bvid=${x.bvid}`, title: x.title, who: x.author, sub: dur(x.duration), cover: x.cover,
        progress: x.duration > 0 ? (x.progress < 0 ? 1 : x.progress / x.duration) : undefined,
      }));
    },
  }),
};
