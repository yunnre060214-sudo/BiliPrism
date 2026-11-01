/* eslint-disable @typescript-eslint/no-explicit-any */
const https = (u: unknown) => String(u ?? '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:');
const BASE = { build: '0', mobi_app: 'web' };

async function get<T>(url: string, params: Record<string, string | number> = {}): Promise<T> {
  const q = new URLSearchParams({ ...BASE, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const r = await fetch(`${url}?${q}`, { credentials: 'include' });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.message || j.msg || `code ${j.code}`);
  return j.data as T;
}

export interface Person { mid: number; name: string; face: string }
export interface Notice {
  id: number; kind: 'reply' | 'at' | 'like' | 'system';
  users: Person[]; more: number; time: number;
  verb: string; content: string; quote: string; title: string; image: string; url: string;
}
export interface Page { list: Notice[]; cursor: { id: number; time: number } | null }
export interface Unread { reply: number; at: number; like: number; system: number; chat: number }

const person = (u: any): Person => ({ mid: u?.mid ?? 0, name: u?.nickname ?? u?.name ?? '', face: https(u?.avatar ?? u?.face) });
const VERB: Record<string, string> = { video: '视频', reply: '评论', dynamic: '动态', article: '专栏', album: '动态' };

export async function unread(): Promise<Unread> {
  const [a, b] = await Promise.all([
    get<any>('https://api.bilibili.com/x/msgfeed/unread').catch(() => ({})),
    get<any>('https://api.vc.bilibili.com/session_svr/v1/session_svr/single_unread', { unread_type: 0, show_unfollow_list: 1, show_dustbin: 1 }).catch(() => ({})),
  ]);
  return { reply: a.reply ?? 0, at: a.at ?? 0, like: a.like ?? 0, system: a.sys_msg ?? 0, chat: (b.follow_unread ?? 0) + (b.unfollow_unread ?? 0) };
}

export async function replies(c: Page['cursor']): Promise<Page> {
  const d = await get<any>('https://api.bilibili.com/x/msgfeed/reply', c ? { id: c.id, reply_time: c.time, platform: 'web' } : { platform: 'web' });
  return {
    list: (d.items ?? []).map((x: any): Notice => ({
      id: x.id, kind: 'reply', users: [person(x.user)], more: 0, time: x.reply_time,
      verb: `回复了我的${VERB[x.item?.type] ?? '内容'}`, content: x.item?.source_content ?? '',
      quote: x.item?.target_reply_content || x.item?.root_reply_content || x.item?.title || '',
      title: x.item?.title ?? '', image: https(x.item?.image), url: https(x.item?.uri),
    })),
    cursor: d.cursor && !d.cursor.is_end ? { id: d.cursor.id, time: d.cursor.time } : null,
  };
}

export async function ats(c: Page['cursor']): Promise<Page> {
  const d = await get<any>('https://api.bilibili.com/x/msgfeed/at', c ? { id: c.id, at_time: c.time } : {});
  return {
    list: (d.items ?? []).map((x: any): Notice => ({
      id: x.id, kind: 'at', users: [person(x.user)], more: 0, time: x.at_time,
      verb: `在${VERB[x.item?.type] ?? '内容'}中 @ 了我`, content: x.item?.source_content ?? '', quote: x.item?.title ?? '',
      title: x.item?.title ?? '', image: https(x.item?.image), url: https(x.item?.uri),
    })),
    cursor: d.cursor && !d.cursor.is_end ? { id: d.cursor.id, time: d.cursor.time } : null,
  };
}

export async function likes(c: Page['cursor']): Promise<Page> {
  const d = await get<any>('https://api.bilibili.com/x/msgfeed/like', c ? { id: c.id, like_time: c.time } : {});
  const t = d.total ?? {};
  return {
    list: (t.items ?? []).map((x: any): Notice => ({
      id: x.id, kind: 'like', users: (x.users ?? []).map(person), more: Math.max(0, (x.counts ?? 0) - (x.users ?? []).length), time: x.like_time,
      verb: `赞了我的${VERB[x.item?.type] ?? '内容'}`, content: '', quote: x.item?.title ?? '',
      title: x.item?.title ?? '', image: https(x.item?.image), url: https(x.item?.uri),
    })),
    cursor: t.cursor && !t.cursor.is_end ? { id: t.cursor.id, time: t.cursor.time } : null,
  };
}

export async function system(csrf: string, c: Page['cursor']): Promise<Page> {
  const d = await get<any>('https://message.bilibili.com/x/sys-msg/query_user_notify', { csrf, page_size: 20, ...(c ? { cursor: c.id } : {}) });
  const list: Notice[] = (d.system_notify_list ?? []).map((x: any): Notice => ({
    id: x.id, kind: 'system', users: [], more: 0, time: Date.parse(String(x.time_at).replace(' ', 'T') + '+08:00') / 1000 || 0,
    verb: '', content: String(x.content ?? '').replace(/#\{([^}]*)\}\{"?[^}]*"?\}/g, '$1'), quote: '', title: x.title ?? '', image: '', url: '',
  }));
  const last = list[list.length - 1];
  return { list, cursor: list.length >= 20 && last ? { id: last.id, time: last.time } : null };
}

// ---- 私信 ----
export interface Session { talker: number; unread: number; last: string; ts: number; person?: Person }
export interface Msg { sender: number; type: number; text: string; image: string; ts: number; key: string }

export function msgText(type: number, raw: string): { text: string; image: string } {
  let c: any = {};
  try { c = JSON.parse(raw); } catch { return { text: raw, image: '' }; }
  if (type === 1) return { text: c.content ?? '', image: '' };
  if (type === 2) return { text: '', image: https(c.url) };
  if (type === 5) return { text: '撤回了一条消息', image: '' };
  return { text: c.title || c.text || c.content || '[卡片消息]', image: https(c.cover || c.thumb) };
}

export async function sessions(): Promise<Session[]> {
  const d = await get<any>('https://api.vc.bilibili.com/session_svr/v1/session_svr/get_sessions', { session_type: 1, group_fold: 1, unfollow_fold: 0, sort_rule: 2 });
  const list: Session[] = (d.session_list ?? []).filter((s: any) => s.session_type === 1).map((s: any) => ({
    talker: s.talker_id, unread: s.unread_count ?? 0, ts: s.session_ts ? Math.floor(s.session_ts / 1e6) : s.last_msg?.timestamp ?? 0,
    last: s.last_msg ? msgText(s.last_msg.msg_type, s.last_msg.content).text || '[图片]' : '',
  }));
  const ids = list.map((s) => s.talker).slice(0, 50);
  if (ids.length) {
    const cards = await get<any[]>('https://api.vc.bilibili.com/account/v1/user/cards', { uids: ids.join(',') }).catch(() => []);
    const by = new Map(cards.map((c: any) => [c.mid, person(c)]));
    list.forEach((s) => (s.person = by.get(s.talker)));
  }
  return list;
}

export async function messages(talker: number): Promise<Msg[]> {
  const d = await get<any>('https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs', { talker_id: talker, session_type: 1, size: 30 });
  return (d.messages ?? []).map((m: any): Msg => ({ sender: m.sender_uid, type: m.msg_type, ...msgText(m.msg_type, m.content), ts: m.timestamp, key: String(m.msg_key) })).reverse();
}

export async function sendText(me: number, to: number, text: string, csrf: string): Promise<boolean> {
  const dev = crypto.randomUUID().toUpperCase();
  const body = new URLSearchParams({
    'msg[sender_uid]': String(me), 'msg[receiver_type]': '1', 'msg[receiver_id]': String(to), 'msg[msg_type]': '1', 'msg[msg_status]': '0',
    'msg[content]': JSON.stringify({ content: text }), 'msg[new_face_version]': '0', 'msg[dev_id]': dev, 'msg[timestamp]': String(Math.floor(Date.now() / 1000)),
    from_firework: '0', build: '0', mobi_app: 'web', csrf_token: csrf, csrf,
  });
  const r = await fetch('https://api.vc.bilibili.com/web_im/v1/web_im/send_msg', { method: 'POST', credentials: 'include', body });
  const j = await r.json().catch(() => ({}));
  return j.code === 0;
}
