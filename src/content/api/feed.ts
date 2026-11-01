import { getJSON, getWbi } from './http';

export interface Video {
  bvid: string;
  cid: number;
  title: string;
  cover: string;
  duration: number;
  author: string;
  mid: number;
  face: string;
  views: number;
  danmaku: number;
  pubdate: number;
  reason?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const toVideo = (v: any): Video => ({
  bvid: v.bvid,
  cid: Number(v.cid) || 0,
  title: v.title,
  cover: String(v.pic || '').replace(/^http:/, 'https:'),
  duration: Number(v.duration) || 0,
  author: v.owner?.name ?? '',
  mid: v.owner?.mid ?? 0,
  face: v.owner?.face ?? '',
  views: v.stat?.view ?? 0,
  danmaku: v.stat?.danmaku ?? 0,
  pubdate: v.pubdate ?? 0,
  reason: v.rcmd_reason?.content || undefined,
});

export async function recommended(round: number): Promise<Video[]> {
  const data = await getWbi<{ item: any[] }>('/x/web-interface/wbi/index/top/feed/rcmd', {
    web_location: 1430650,
    feed_version: 'V8',
    homepage_ver: 1,
    fresh_type: 4,
    y_num: 4,
    last_y_num: 5,
    ps: 12,
    fresh_idx: round,
    fresh_idx_1h: round,
    brush: round,
  });
  return (data.item || []).filter((v) => v.goto === 'av' && v.bvid).map(toVideo);
}

export async function popular(page: number): Promise<{ list: Video[]; done: boolean }> {
  const data = await getJSON<{ list: any[]; no_more: boolean }>('/x/web-interface/popular', { ps: 20, pn: page });
  return { list: (data.list || []).map(toVideo), done: data.no_more };
}
