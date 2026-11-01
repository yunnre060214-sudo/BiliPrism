/**
 * B 站足迹：每天首次打开时间与停留时长。
 * 只存在本机 chrome.storage.local；计时由后台 service worker 统一累计（见 src/background/sw.ts），
 * 登录后可用 B 站观看历史补全过去的天数。
 */
import { ACTIVITY_KEY as KEY, dayKey, hhmm, type Activity, type DayRecord, type FpMessage } from '../../shared/activity';
export { dayKey, type Activity, type DayRecord };

const LEGACY = 'margin-activity-v1';

export async function loadActivity(): Promise<Activity> {
  const v = await chrome.storage.local.get([KEY, LEGACY]);
  const cur = (v[KEY] as Activity | undefined) ?? {};
  const old = v[LEGACY] as Activity | undefined;
  if (old && !v[KEY]) { await chrome.storage.local.set({ [KEY]: old }); return { ...old }; }
  return cur;
}

interface HistoryItem { view_at: number; duration?: number; progress?: number }

/** 一条观看历史最多算 20 分钟：历史只知道看到哪、不知道看了多久，宁可少算 */
const ITEM_CAP = 20 * 60;
/** 翻页硬上限（30 条一页），防止历史特别多时一直翻 */
const MAX_PAGES = 60;
/** 本机停留不到 60 秒的日子不算「打开过」，也不挡住观看历史的估算 */
export const ACTIVE_MIN = 60;

/** 估算单条观看历史的时长：min(视频时长, 看到的进度, 20 分钟)；进度 -1 表示看完 */
export function itemSeconds(it: HistoryItem): number {
  const dur = Math.max(0, Number(it.duration) || 0);
  const prog = Number(it.progress);
  let s = prog < 0 ? dur : Math.max(0, prog || 0);
  if (dur > 0) s = Math.min(s, dur);
  return Math.min(s, ITEM_CAP);
}

/**
 * 用观看历史补全：一直往回翻，直到翻过热力图最早显示的那天（since，本地 0 点）或到硬上限。
 * 只写 since 之后、且完整翻到的日子；估算只在没有本机记录的日子上显示（见 secondsOf）。
 */
export async function backfill(since: Date): Promise<'ok' | 'nologin' | 'fail'> {
  const sums: Record<string, number> = {};
  const firsts: Record<string, string> = {};
  const floor = Math.floor(+since / 1000);
  let max = 0, viewAt = 0, business = '', oldest = Infinity, reached = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    let j: { code: number; data?: { list?: HistoryItem[]; cursor?: { max: number; view_at: number; business?: string } } };
    try {
      if (page) await new Promise((r) => setTimeout(r, 250)); // 别把接口打太快
      j = await fetch(`https://api.bilibili.com/x/web-interface/history/cursor?ps=30&max=${max}&view_at=${viewAt}&business=${business}`, { credentials: 'include' }).then((r) => r.json());
    } catch { if (!page) return 'fail'; break; }
    if (j.code !== 0) { if (!page) return j.code === -101 ? 'nologin' : 'fail'; break; }
    const list = j.data?.list ?? [];
    for (const it of list) {
      oldest = Math.min(oldest, it.view_at);
      if (it.view_at < floor) { reached = true; continue; }
      const d = new Date(it.view_at * 1000);
      const k = dayKey(d);
      sums[k] = (sums[k] || 0) + itemSeconds(it);
      const t = hhmm(d);
      if (!firsts[k] || t < firsts[k]) firsts[k] = t;
    }
    const c = j.data?.cursor;
    if (reached || !list.length || !c?.max) { reached = true; break; }
    max = c.max; viewAt = c.view_at; business = c.business ?? '';
  }
  // 撞到硬上限还没翻完：最老的那天可能只翻到一半，不写
  if (!reached && oldest !== Infinity) delete sums[dayKey(new Date(oldest * 1000))];
  // 交给后台串行写入，避免和心跳计时互相覆盖
  const days: Record<string, { h: number; hf?: string }> = {};
  for (const k of Object.keys(sums)) days[k] = { h: Math.round(sums[k]), hf: firsts[k] };
  await chrome.runtime.sendMessage({ margin: 'fp', op: 'merge', days } satisfies FpMessage);
  return 'ok';
}

/** 这一天有没有本机记录（够 60 秒才算） */
export const isLocal = (d?: DayRecord) => (d?.s || 0) >= ACTIVE_MIN;
/** 显示用的时长：有本机记录用本机，没有才用观看历史估算 */
export const secondsOf = (d?: DayRecord) => (isLocal(d) ? d!.s : Math.max(d?.s || 0, d?.h || 0));
/** 时长来源 */
export const sourceOf = (d?: DayRecord): 'local' | 'history' | null => (isLocal(d) ? 'local' : (d?.h || 0) > 0 ? 'history' : (d?.s || 0) > 0 ? 'local' : null);
/** 算进「打开过」和连续天数：累计满 60 秒 */
export const activeOf = (d?: DayRecord) => secondsOf(d) >= ACTIVE_MIN;
export const firstOf = (d?: DayRecord) => {
  if (isLocal(d)) return d!.f || d!.hf;
  const a = d?.f, b = d?.hf;
  return a && b ? (a < b ? a : b) : a || b;
};

/**
 * 热力图分档阈值（秒）：用近一年活跃日时长的四分位数，跟着自己的习惯走；
 * 活跃日不到 14 天时用固定的 15 / 45 / 90 分钟。
 */
export function levelThresholds(values: number[]): [number, number, number] {
  const v = values.filter((x) => x >= ACTIVE_MIN).sort((a, b) => a - b);
  if (v.length < 14) return [900, 2700, 5400];
  const q = (p: number) => { const i = (v.length - 1) * p, lo = Math.floor(i); return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo); };
  const t: [number, number, number] = [q(0.25), q(0.5), q(0.75)];
  // 分布太集中时拉开一点，避免几档阈值重合
  if (t[1] <= t[0]) t[1] = t[0] + 1;
  if (t[2] <= t[1]) t[2] = t[1] + 1;
  return t;
}
export const levelOf = (s: number, t: [number, number, number]) => (s < ACTIVE_MIN ? 0 : s <= t[0] ? 1 : s <= t[1] ? 2 : s <= t[2] ? 3 : 4);
