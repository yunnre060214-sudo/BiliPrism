/* eslint-disable @typescript-eslint/no-explicit-any */
import { getJSON } from './http';

/** 一条动态，抽成渲染需要的最小结构 */
export interface Dyn {
  id: string; type: string; author: string; face: string; mid: number; ts: number; time: string;
  text: string; title?: string;
  video?: { bvid: string; title: string; cover: string; dur: string; play: string; desc: string };
  pics: string[];
  article?: { title: string; cover: string; desc: string; url: string };
  segments?: { text: string; url?: string; image?: string }[];
  attachment?: { title: string; cover: string; desc: string; url: string; kind: string };
  orig?: Dyn | null;
  stat: { comment: number; forward: number; like: number };
  url: string;
}

const https = (u: unknown) => String(u ?? '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:');

const safeLink = (value: unknown) => {
  if(typeof value !== 'string' || !value.trim()) return '';
  try { const u = new URL(https(value), 'https://www.bilibili.com'); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch { return ''; }
};
const FEATURES = 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard,onlyfansAssetsV2,forwardListHidden,ugcDelete,onlyfansQaCard';
export function toDyn(it: any): Dyn | null {
  if (!it?.modules) return null;
  const m = it.modules, a = m.module_author ?? {}, d = m.module_dynamic ?? {}, s = m.module_stat ?? {};
  const major = d.major ?? {};
  const opus = major.opus;
  const text = (opus?.summary?.text ?? d.desc?.text ?? '').trim();
  const out: Dyn = {
    id: it.id_str, type: it.type, author: a.name ?? '', face: https(a.face), mid: a.mid ?? 0, ts: a.pub_ts ?? 0, time: a.pub_time ?? '',
    text, title: opus?.title || undefined, pics: [],
    stat: { comment: s.comment?.count ?? 0, forward: s.forward?.count ?? 0, like: s.like?.count ?? 0 },
    url: `https://www.bilibili.com/opus/${it.id_str}`,
  };
  if (major.archive || major.ugc_season?.bvid) {
    const v = major.archive ?? major.ugc_season;
    out.video = { bvid: v.bvid, title: v.title, cover: https(v.cover), dur: v.duration_text ?? '', play: v.stat?.play ?? '', desc: v.desc ?? '' };
    out.url = `https://www.bilibili.com/video/${v.bvid}`;
  }
  if (opus?.pics) out.pics = opus.pics.map((p: any) => https(p.url));
  else if (major.draw?.items) out.pics = major.draw.items.map((p: any) => https(p.src));
  if (major.article) {
    const r = major.article;
    out.article = { title: r.title, cover: https(r.covers?.[0]), desc: r.desc ?? '', url: https(r.jump_url) };
  }
  const rich = opus?.summary?.rich_text_nodes ?? d.desc?.rich_text_nodes;
  if (Array.isArray(rich)) out.segments = rich.map((n: any) => ({
    text: String(n.text ?? n.orig_text ?? ''),
    url: n.jump_url ? safeLink(n.jump_url) : n.type === 'RICH_TEXT_NODE_TYPE_AT' && /^\d+$/.test(String(n.rid)) ? `https://space.bilibili.com/${n.rid}` : undefined,
    image: n.type === 'RICH_TEXT_NODE_TYPE_EMOJI' ? safeLink(n.emoji?.webp_url || n.emoji?.icon_url) : undefined,
  }));
  const extra = major.pgc ?? major.common ?? major.upower_common;
  if (extra && !out.video && !out.article) out.attachment = {
    title: extra.title ?? '查看动态内容', cover: https(extra.cover), desc: extra.desc ?? '',
    url: safeLink(extra.jump_url) || `https://t.bilibili.com/${out.id}`, kind: major.pgc ? 'PGC' : 'LINK',
  };
  if (it.orig) out.orig = toDyn(it.orig);
  return out;
}

export async function spaceDynamics(mid: number, offset: string): Promise<{ list: Dyn[]; offset: string; more: boolean }> {
  const d = await getJSON<any>('/x/polymer/web-dynamic/v1/feed/space', { host_mid: mid, offset, timezone_offset: -480, features: FEATURES });
  return { list: (d.items ?? []).map(toDyn).filter(Boolean) as Dyn[], offset: d.offset ?? '', more: !!d.has_more };
}

export type FeedType = 'all' | 'video' | 'pgc' | 'article';
/** 关注动态流；hostMid 只看某个 UP */
export async function followFeed(type: FeedType, offset: string, hostMid = 0): Promise<{ list: Dyn[]; offset: string; more: boolean; baseline: string }> {
  const p: Record<string, string | number> = { type, offset, timezone_offset: -480, features: FEATURES };
  if (hostMid) p.host_mid = hostMid;
  const d = await getJSON<any>('/x/polymer/web-dynamic/v1/feed/all', p);
  return { list: (d.items ?? []).map(toDyn).filter(Boolean) as Dyn[], offset: d.offset ?? '', more: !!d.has_more, baseline: d.update_baseline ?? '' };
}

export interface Up { mid: number; name: string; face: string; fresh: boolean }
export interface LiveUp { mid: number; name: string; face: string; title: string; url: string }
/** 顶部「最常访问」头像条 + 正在直播 */
export async function portal(): Promise<{ ups: Up[]; live: LiveUp[]; liveCount: number }> {
  const d = await getJSON<any>('/x/polymer/web-dynamic/v1/portal');
  const ups = (d.up_list?.items ?? []).map((u: any) => ({ mid: u.mid, name: u.uname, face: https(u.face), fresh: !!u.has_update }));
  const live = (d.live_users?.items ?? []).map((u: any) => ({ mid: u.mid, name: u.uname, face: https(u.face), title: u.title ?? '', url: https(u.jump_url || `https://live.bilibili.com/${u.room_id}`) }));
  return { ups, live, liveCount: d.live_users?.count ?? live.length };
}
