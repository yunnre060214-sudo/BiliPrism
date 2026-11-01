import type { Settings } from '../../shared/settings';
import { nav } from '../api/http';
import { ats, likes, messages, replies, sendText, sessions, system, unread, type Notice, type Page, type Session } from '../api/msg';
import { dayBucket, fmtAgo, h, icon, ICONS, svg } from './dom';
import { toast } from './controls';
import { csrf, PageShell } from './shell';

type View = 'whisper' | 'reply' | 'at' | 'like' | 'system';
const VIEWS: [View, string, string][] = [
  ['whisper', '我的消息', 'Chat'], ['reply', '回复我的', 'Reply'], ['at', '@ 我的', 'Mention'], ['like', '收到的赞', 'Like'], ['system', '系统通知', 'System'],
];
/** B 站原版的 hash 路由 → 我们的视图 */
const HASH: Record<string, View> = { whisper: 'whisper', reply: 'reply', at: 'at', love: 'like', system: 'system' };
const HASH_OF: Record<View, string> = { whisper: 'whisper', reply: 'reply', at: 'at', like: 'love', system: 'system' };

/** 消息中心：左侧目录（带未读数）+ 右侧阅读栏；私信是会话列表 + 对话 */
export class MessageApp {
  readonly shell: PageShell;
  private view: View;
  private nav!: HTMLElement;
  private pane!: HTMLElement;
  private me = 0;
  private gen = 0;

  constructor(settings: Settings) {
    this.shell = new PageShell(settings, 'msg');
    const m = location.hash.match(/^#\/(\w+)/);
    this.view = HASH[m?.[1] ?? ''] ?? 'reply';
    this.render();
  }

  update(s: Settings): void { this.shell.update(s); }

  private render(): void {
    this.nav = h('nav', { class: 'ms-nav' },
      h('div', { class: 'eyebrow' }, h('span', { class: 'en' }, 'Inbox')),
      h('h1', { class: 'ms-h1' }, '消息'),
      ...VIEWS.map(([id, label]) => {
        const b = h('button', { class: 'ms-item', type: 'button', onclick: () => this.go(id) }, h('span', {}, label), h('b', { class: 'ms-n' }));
        b.dataset.view = id;
        return b;
      }));
    this.pane = h('section', { class: 'ms-pane' });
    this.shell.main.append(h('div', { class: 'ms' }, this.nav, this.pane));
    addEventListener('hashchange', () => { const m = location.hash.match(/^#\/(\w+)/); const v = HASH[m?.[1] ?? '']; if (v && v !== this.view) { this.view = v; this.show(); } });
    nav().then((n) => {
      if (!n?.isLogin) { this.pane.replaceChildren(this.empty('登录后查看消息', h('a', { class: 'sp-follow', href: 'https://passport.bilibili.com/login', target: '_blank', rel: 'noopener' }, '去登录'))); return; }
      this.me = n.mid ?? 0;
      this.refreshUnread();
      this.show();
    }).catch(() => this.show());
  }

  private async refreshUnread(): Promise<void> {
    const u = await unread().catch(() => null);
    if (!u) return;
    const n: Record<View, number> = { whisper: u.chat, reply: u.reply, at: u.at, like: u.like, system: u.system };
    this.nav.querySelectorAll<HTMLElement>('.ms-item').forEach((b) => { const c = n[b.dataset.view as View]; b.querySelector('.ms-n')!.textContent = c ? (c > 99 ? '99+' : String(c)) : ''; });
  }

  private go(v: View): void {
    if (v === this.view && !location.hash.includes('/mid')) return;
    this.view = v;
    history.replaceState(null, '', `#/${HASH_OF[v]}`);
    this.show();
  }

  private show(): void {
    this.gen++;
    this.nav.querySelectorAll<HTMLElement>('.ms-item').forEach((b) => b.toggleAttribute('data-selected', b.dataset.view === this.view));
    const [, label, eb] = VIEWS.find((x) => x[0] === this.view)!;
    this.pane.replaceChildren(h('header', { class: 'ms-head' }, h('div', { class: 'eyebrow' }, h('span', { class: 'en' }, eb)), h('h2', {}, label)));
    if (this.view === 'whisper') this.whisper();
    else this.feed();
  }

  private empty(text: string, extra?: Node): HTMLElement {
    return h('div', { class: 'ms-empty' }, h('p', {}, text), extra ?? null);
  }

  // ---- 通知流 ----
  private feed(): void {
    const gen = this.gen;
    const list = h('div', { class: 'ms-list' });
    const more = h('button', { class: 'ghost small ms-more', type: 'button' }, '加载更多');
    this.pane.append(list, more);
    let cursor: Page['cursor'] = null;
    let bucket = '';
    const fetcher = (c: Page['cursor']) => this.view === 'reply' ? replies(c) : this.view === 'at' ? ats(c) : this.view === 'like' ? likes(c) : system(csrf(), c);
    const load = async () => {
      more.disabled = true;
      list.append(...Array.from({ length: cursor ? 2 : 5 }, () => h('div', { class: 'ms-row sk' }, h('div', { class: 'ms-face' }), h('div', {}, h('div', { class: 'line' }), h('div', { class: 'line short' })))));
      try {
        const p = await fetcher(cursor);
        if (gen !== this.gen) return;
        list.querySelectorAll('.sk').forEach((n) => n.remove());
        p.list.forEach((n) => {
          const b = dayBucket(n.time, true);
          if (b !== bucket) { bucket = b; list.append(h('div', { class: 'ms-day' }, h('span', {}, b))); }
          list.append(this.row(n));
        });
        cursor = p.cursor;
        more.hidden = !cursor;
        if (!list.children.length) list.append(this.empty('这里还空着'));
      } catch (e) {
        if (gen !== this.gen) return;
        list.querySelectorAll('.sk').forEach((n) => n.remove());
        list.append(this.empty(`加载失败：${(e as Error).message}`));
        more.hidden = true;
      } finally { more.disabled = false; }
    };
    more.addEventListener('click', load);
    load();
  }

  private row(n: Notice): HTMLElement {
    const ext = { target: '_blank', rel: 'noopener' };
    if (n.kind === 'system') {
      return h('article', { class: 'ms-row sys' },
        h('div', { class: 'ms-main' },
          h('div', { class: 'ms-line' }, h('b', { class: 'ms-title' }, n.title), h('time', {}, fmtAgo(n.time))),
          h('p', { class: 'ms-text' }, n.content)));
    }
    const u = n.users[0];
    const names = n.users.slice(0, 2).map((x) => h('a', { class: 'ms-name', href: `https://space.bilibili.com/${x.mid}`, ...ext }, x.name));
    const who: Node[] = [];
    names.forEach((a, i) => { if (i) who.push(document.createTextNode('、')); who.push(a); });
    if (n.more > 0) who.push(h('span', { class: 'ms-more-n' }, ` 等 ${n.more + names.length} 人`));
    const badge = n.kind === 'like' ? svg('<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1Z"/></svg>')
      : n.kind === 'at' ? document.createTextNode('@') : icon(ICONS.message);
    const showQuote = n.quote && n.quote !== n.title;
    return h('article', { class: `ms-row ${n.kind}` },
      h('a', { class: 'ms-faces', href: u ? `https://space.bilibili.com/${u.mid}` : '#', 'aria-label': u ? `${u.name} 的个人空间` : '个人空间', ...ext },
        ...n.users.slice(0, n.kind === 'like' ? 3 : 1).map((x) => h('img', { class: 'ms-face', src: x.face ? `${x.face}@80w_80h_1c.webp` : '', alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })),
        h('i', { class: 'ms-badge' }, badge)),
      h('div', { class: 'ms-main' },
        h('div', { class: 'ms-line' },
          h('p', { class: 'ms-sent' }, h('span', { class: 'ms-who' }, ...who), ' ', h('span', { class: 'ms-verb' }, n.verb),
            n.title ? h('a', { class: 'ms-obj', href: n.url || '#', ...ext }, n.title) : null),
          h('time', {}, fmtAgo(n.time))),
        n.content ? h('p', { class: 'ms-text' }, n.content) : null,
        showQuote ? h('a', { class: 'ms-quote', href: n.url || '#', ...ext }, h('span', { class: 'ms-q-k' }, '原文'), n.quote) : null,
        n.kind === 'reply' && n.url ? h('div', { class: 'ms-acts' }, h('a', { class: 'ms-act ghost', href: n.url, ...ext }, icon(ICONS.message), '去回复')) : null),
      n.image ? h('a', { class: 'ms-thumb', href: n.url || '#', 'aria-label': n.title ? `打开「${n.title}」` : '打开原内容', ...ext }, h('img', { src: `${n.image}@240w_150h_1c.webp`, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })) : null);
  }

  // ---- 私信 ----
  private whisper(): void {
    const gen = this.gen;
    const list = h('div', { class: 'wh-list' });
    const chat = h('div', { class: 'wh-chat' }, this.empty('选一个会话开始聊天'));
    this.pane.append(h('div', { class: 'wh' }, list, chat));
    const want = Number(location.hash.match(/mid(\d+)/)?.[1] || 0);
    sessions().then((ss) => {
      if (gen !== this.gen) return;
      if (!ss.length) { list.append(this.empty('还没有私信')); return; }
      let target = ss.find((s) => s.talker === want);
      if (want && !target) { target = { talker: want, unread: 0, last: '', ts: 0 }; ss.unshift(target); }
      let bucket = '';
      ss.forEach((s) => {
        const b = s.ts ? dayBucket(s.ts) : '';
        if (b && b !== bucket) { bucket = b; list.append(h('div', { class: 'wh-day' }, b)); }
        list.append(this.sessionRow(s, chat, list));
      });
      if (target) (list.querySelector(`[data-talker="${target.talker}"]`) as HTMLElement)?.click();
    }).catch((e) => { if (gen === this.gen) list.append(this.empty(`加载失败：${(e as Error).message}`)); });
  }

  private sessionRow(s: Session, chat: HTMLElement, list: HTMLElement): HTMLElement {
    const name = s.person?.name || `UID ${s.talker}`;
    const b = h('button', { class: 'wh-s', type: 'button' },
      h('img', { class: 'ms-face', src: s.person?.face ? `${s.person.face}@80w_80h_1c.webp` : '', alt: '', referrerpolicy: 'no-referrer' }),
      h('span', { class: 'wh-sb' }, h('span', { class: 'wh-sn' }, h('b', {}, name), h('time', {}, s.ts ? fmtAgo(s.ts) : '')), h('span', { class: 'wh-sl' }, s.last)),
      s.unread ? h('i', { class: 'wh-dot' }, String(s.unread)) : null);
    b.dataset.talker = String(s.talker);
    b.addEventListener('click', () => {
      list.querySelectorAll('.wh-s').forEach((x) => x.toggleAttribute('data-selected', x === b));
      b.querySelector('.wh-dot')?.remove();
      history.replaceState(null, '', `#/whisper/mid${s.talker}`);
      this.openChat(s, name, chat);
    });
    return b;
  }

  private async openChat(s: Session, name: string, chat: HTMLElement): Promise<void> {
    const log = h('div', { class: 'wh-log' });
    const input = h('textarea', { class: 'wh-input', rows: 1, placeholder: `发消息给 ${name}`, maxlength: 500 }) as HTMLTextAreaElement;
    const send = h('button', { class: 'wh-send', type: 'button' }, '发送');
    chat.replaceChildren(
      h('header', { class: 'wh-head' }, h('a', { href: `https://space.bilibili.com/${s.talker}`, target: '_blank', rel: 'noopener' }, name), h('span', { class: 'eyebrow' }, `UID ${s.talker}`)),
      log, h('div', { class: 'wh-compose' }, input, send));
    const paint = (list: Awaited<ReturnType<typeof messages>>) => {
      log.replaceChildren(...list.map((m) => h('div', { class: `wh-m${m.sender === this.me ? ' me' : ''}` },
        m.image ? h('img', { src: `${m.image}@360w.webp`, alt: '', referrerpolicy: 'no-referrer' }) : null,
        m.text ? h('p', {}, m.text) : null,
        h('time', {}, fmtAgo(m.ts)))));
      log.scrollTop = log.scrollHeight;
    };
    try { paint(await messages(s.talker)); } catch (e) { log.replaceChildren(this.empty(`加载失败：${(e as Error).message}`)); }
    const go = async () => {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      const ok = await sendText(this.me, s.talker, text, csrf()).catch(() => false);
      send.disabled = false;
      if (!ok) { toast(this.shell.app, '发送失败'); return; }
      input.value = '';
      paint(await messages(s.talker).catch(() => []));
    };
    send.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); go(); } });
    input.focus();
  }
}

