import type { Filters } from '../shared/settings';
import type { Video } from './api/feed';

export type Predicate = (v: Video) => boolean;

function keywordTest(k: string): ((s: string) => boolean) | null {
  const t = k.trim();
  if (!t) return null;
  const m = /^\/(.+)\/([a-z]*)$/.exec(t);
  if (m) {
    try { const re = new RegExp(m[1], m[2].includes('i') ? m[2] : `${m[2]}i`); return (s) => { re.lastIndex = 0; return re.test(s); }; } catch { return null; }
  }
  const low = t.toLowerCase();
  return (s) => s.toLowerCase().includes(low);
}

export function compileFilter(f: Filters): Predicate {
  const kws = f.keywords.map(keywordTest).filter(Boolean) as ((s: string) => boolean)[];
  const mids = new Set<number>();
  const names = new Set<string>();
  for (const u of f.ups) {
    const t = u.trim();
    if (/^\d+$/.test(t)) mids.add(Number(t));
    else if (t) names.add(t.toLowerCase());
  }
  return (v) =>
    !kws.some((k) => k(v.title)) &&
    !mids.has(v.mid) &&
    !names.has(v.author.toLowerCase()) &&
    v.views >= f.minViews &&
    (f.minDuration <= 0 || !v.duration || v.duration >= f.minDuration);
}
