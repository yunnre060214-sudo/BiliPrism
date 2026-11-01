/**
 * 映棱后台 service worker：只做一件事——足迹计时。
 * 各标签页在活跃时发心跳（一段时间区间），这里串行地读-改-写 chrome.storage.local，
 * 多标签页同时打开也不会互相覆盖或重复累计（v0.30 及更早是各页面自己读改写，会丢数据）。
 */
import { ACTIVITY_KEY, SLOTS_KEY, applyBeat, dayKey, hhmm, mergeActivity, sanitizeActivity, type Activity, type FpMessage } from '../shared/activity';

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

async function handle(m: FpMessage): Promise<unknown> {
  const v = await chrome.storage.local.get([ACTIVITY_KEY, SLOTS_KEY]);
  const data = (v[ACTIVITY_KEY] as Activity | undefined) ?? {};
  const now = Date.now();
  if (m.op === 'open') {
    const d = new Date(Math.min(m.at || now, now));
    const day = (data[dayKey(d)] ??= { s: 0 });
    if (day.f) return { ok: true };
    day.f = hhmm(d);
    await chrome.storage.local.set({ [ACTIVITY_KEY]: data });
    return { ok: true };
  }
  if (m.op === 'beat') {
    const to = Math.min(Number(m.to) || 0, now + 5_000);
    const from = Math.max(Number(m.from) || 0, to - 70_000);
    if (!(to > from)) return { ok: false };
    const slots = (v[SLOTS_KEY] as Record<string, number[]> | undefined) ?? {};
    const added = applyBeat(data, slots, from, to);
    if (added) await chrome.storage.local.set({ [ACTIVITY_KEY]: data, [SLOTS_KEY]: slots });
    return { ok: true, added };
  }
  if (m.op === 'merge') {
    for (const [k, x] of Object.entries(m.days ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      const day = (data[k] ??= { s: 0 });
      day.h = Math.max(0, Math.round(Number(x.h) || 0));
      if (x.hf) day.hf = x.hf;
    }
    await chrome.storage.local.set({ [ACTIVITY_KEY]: data });
    return { ok: true };
  }
  if (m.op === 'import') {
    const add = sanitizeActivity(m.days);
    if (!add) return { ok: false };
    mergeActivity(data, add);
    await chrome.storage.local.set({ [ACTIVITY_KEY]: data });
    return { ok: true, days: Object.keys(add).length };
  }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((m: FpMessage, _sender, reply) => {
  if (!m || m.margin !== 'fp') return;
  serial(() => handle(m)).then(reply, (e) => reply({ ok: false, error: String(e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  // v0.30 及更早的页面级节流戳，已不再使用
  chrome.storage.local.remove('biliprism:activity-tick').catch(() => {});
});
