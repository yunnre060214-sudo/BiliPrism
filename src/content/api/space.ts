/* eslint-disable @typescript-eslint/no-explicit-any */
import { getJSON, getWbi } from './http';
import type { Video } from './feed';

export interface SpaceInfo {
  mid: number; name: string; face: string; sign: string; level: number;
  banner: string; official: string; vip: string; following: number; follower: number;
  likes: number; views: number; isFollowing: boolean; videoCount: number;
}

const https = (u: unknown) => String(u ?? '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:');

export async function spaceInfo(mid: number): Promise<SpaceInfo> {
  const [acc, rel, up, nav] = await Promise.all([
    getWbi<any>('/x/space/wbi/acc/info', { mid }),
    getJSON<any>('/x/relation/stat', { vmid: mid }).catch(() => null),
    getJSON<any>('/x/space/upstat', { mid }).catch(() => null),
    getJSON<any>('/x/space/navnum', { mid }).catch(() => null),
  ]);
  return {
    mid, name: acc.name, face: https(acc.face), sign: acc.sign ?? '', level: acc.level ?? 0,
    banner: https(acc.top_photo_v2?.l_img || acc.top_photo),
    official: acc.official?.title ?? '', vip: acc.vip?.label?.text ?? '',
    following: rel?.following ?? 0, follower: rel?.follower ?? 0,
    likes: up?.likes ?? 0, views: up?.archive?.view ?? 0,
    isFollowing: !!acc.is_followed, videoCount: nav?.video ?? 0,
  };
}

export type VideoOrder = 'pubdate' | 'click';

export async function spaceVideos(mid: number, pn: number, order: VideoOrder): Promise<{ list: Video[]; total: number }> {
  const d = await getWbi<any>('/x/space/wbi/arc/search', { mid, ps: 30, pn, order, tid: 0, keyword: '', order_avoided: 'true', platform: 'web', web_location: 1550101 });
  const list: Video[] = (d.list?.vlist ?? []).map((v: any) => ({
    bvid: v.bvid, cid: 0, title: v.title, cover: https(v.pic), duration: parseLen(v.length),
    author: v.author, mid: v.mid, face: '', views: Number(v.play) || 0, danmaku: v.video_review ?? 0, pubdate: v.created ?? 0,
  }));
  return { list, total: d.page?.count ?? list.length };
}

function parseLen(s: string): number {
  return String(s || '').split(':').reduce((a, x) => a * 60 + (Number(x) || 0), 0);
}

/** 关注 / 取关（act 1 关注，2 取关） */
export async function follow(mid: number, on: boolean, csrf: string): Promise<boolean> {
  const body = new URLSearchParams({ fid: String(mid), act: on ? '1' : '2', re_src: '11', csrf });
  const r = await fetch('https://api.bilibili.com/x/relation/modify', { method: 'POST', credentials: 'include', body });
  const j = await r.json().catch(() => ({}));
  return j.code === 0;
}
