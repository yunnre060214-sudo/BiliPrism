import type { MomentsSettings } from '../../shared/settings';
import type { Dyn, Up } from '../api/dyn';
export function matchesUser(users: string[], mid: number, name: string): boolean {
  return users.some(v => v.trim() === String(mid) || v.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
}
export function allowMoment(d: Dyn, s: MomentsSettings, wantedOnly = false): boolean {
  if (s.hideReposts && (d.orig || d.type === 'DYNAMIC_TYPE_FORWARD')) return false;
  if (s.hideVideo && (d.video || d.type === 'DYNAMIC_TYPE_AV')) return false;
  if (s.hideArticle && (d.article || d.type === 'DYNAMIC_TYPE_ARTICLE')) return false;
  if (s.hidePictures && d.pics.length) return false;
  if (wantedOnly && !matchesUser(s.wantedUsers, d.mid, d.author)) return false;
  const text: string[] = [];
  let current: Dyn | null | undefined = d;
  for (let depth = 0; current && depth < 5; depth++, current = current.orig) {
    if (matchesUser(s.blockedUsers, current.mid, current.author)) return false;
    text.push(current.text, current.title ?? '', current.video?.title ?? '', current.article?.title ?? '', current.attachment?.title ?? '');
  }
  const content = text.join('\n').toLocaleLowerCase();
  return !s.keywords.some(k => k.trim() && content.includes(k.trim().toLocaleLowerCase()));
}
export function sortUps(ups: Up[], pinned: string[]): Up[] {
  return [...ups].sort((a,b) => Number(matchesUser(pinned,b.mid,b.name))-Number(matchesUser(pinned,a.mid,a.name)) || Number(b.fresh)-Number(a.fresh));
}
