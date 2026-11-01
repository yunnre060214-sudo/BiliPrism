import { getJSON, getWbi } from '../api/http';
export interface Cue { from: number; to: number; content: string }
export interface Subtitle { id: number; lan: string; lan_doc: string; subtitle_url: string }
export type SubtitleFormat = 'srt' | 'txt' | 'json';
export function subtitleTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const pad = (n: number, k = 2) => String(n).padStart(k, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}
export function sanitizeCues(raw: unknown): Cue[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { body?: unknown }).body)) throw new Error('字幕格式无法识别');
  const list = (raw as { body: unknown[] }).body;
  if (list.length > 100000) throw new Error('字幕数据过大');
  return list.filter((c): c is Cue => !!c && typeof c === 'object'
    && typeof (c as Cue).from === 'number' && Number.isFinite((c as Cue).from) && (c as Cue).from >= 0
    && typeof (c as Cue).to === 'number' && Number.isFinite((c as Cue).to) && (c as Cue).to >= (c as Cue).from
    && typeof (c as Cue).content === 'string').map(c => ({ from: c.from, to: c.to, content: c.content }));
}
export function formatSubtitles(cues: Cue[], format: SubtitleFormat): string {
  if (format === 'json') return JSON.stringify({ body: cues }, null, 2);
  if (format === 'txt') return cues.map(c => c.content).join('\n') + '\n';
  return cues.map((c, i) => `${i + 1}\n${subtitleTime(c.from)} --> ${subtitleTime(c.to)}\n${c.content.replace(/\r?\n\s*\r?\n/g, '\n')}\n`).join('\n');
}
export function trustedSubtitleUrl(raw: string): string {
  const u = new URL(raw, 'https://www.bilibili.com/');
  if (u.protocol !== 'https:' || !/(^|\.)(hdslb\.com|bilibili\.com)$/.test(u.hostname) || u.username || u.password)
    throw new Error('字幕链接域名不受支持');
  return u.href;
}
export async function listSubtitles(pageUrl: string): Promise<{ title: string; bvid: string; cid: number; tracks: Subtitle[] }> {
  const u = new URL(pageUrl), id = u.pathname.match(/\/(BV[a-zA-Z0-9]+|av\d+)/i)?.[1];
  if (!id) throw new Error('当前页面没有可识别的视频编号');
  const view = await getJSON<{ bvid: string; title: string; cid: number; pages: { cid: number }[] }>('/x/web-interface/view', id.toLowerCase().startsWith('av') ? { aid: id.slice(2) } : { bvid: id });
  const part = Number(u.searchParams.get('p') || 1);
  if (!Number.isSafeInteger(part) || part < 1 || (view.pages?.length && part > view.pages.length)) throw new Error('分 P 编号无效');
  const cid = view.pages?.[part - 1]?.cid ?? view.cid;
  if (!Number.isSafeInteger(cid) || cid <= 0) throw new Error('无法取得当前分 P 的 CID');
  const data = await getWbi<{ subtitle?: { subtitles?: Subtitle[] } }>('/x/player/wbi/v2', { bvid: view.bvid, cid });
  const tracks = (data.subtitle?.subtitles ?? []).filter(t => typeof t.subtitle_url === 'string' && !!t.subtitle_url);
  if (!tracks.length) throw new Error('当前视频暂无可导出字幕，或需要登录后重试');
  return { title: view.title, bvid: view.bvid, cid, tracks };
}
export async function downloadSubtitle(track: Subtitle, info: { title: string; bvid: string; cid: number }, format: SubtitleFormat): Promise<void> {
  const res = await fetch(trustedSubtitleUrl(track.subtitle_url), { credentials: 'omit' });
  if (!res.ok) throw new Error(`字幕下载失败（HTTP ${res.status}）`);
  const text = await res.text();
  if (text.length > 10_000_000) throw new Error('字幕数据过大');
  const cues = sanitizeCues(JSON.parse(text));
  if (!cues.length) throw new Error('这条字幕没有可用内容');
  const filename = `${info.title.slice(0, 100)}-${info.bvid}-${info.cid}-${track.lan}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const blob = new Blob(['\uFEFF', formatSubtitles(cues, format)], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `${filename}.${format}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
