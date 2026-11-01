import type { Video } from '../api/feed';
import { fmtAgo, fmtCount, fmtDuration, h, icon, ICONS } from './dom';

const thumb = (url: string) => (url ? `${url}@672w_378h_1c.webp` : '');
export const cardData = new WeakMap<Element, Video>();

export interface CardOpts { onBlock?: (v: Video) => void; compact?: boolean }

export function videoCard(v: Video, index: number, opts: CardOpts = {}): HTMLElement {
  const href = `https://www.bilibili.com/video/${v.bvid}`;
  const cover = h('a', { class: 'cover', href, target: '_blank', rel: 'noopener', title: v.title },
    h('img', { src: thumb(v.cover), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
    v.duration ? h('span', { class: 'dur' }, fmtDuration(v.duration)) : null,
  );
  if (opts.onBlock) {
    cover.append(h('button', {
      class: 'card-block', type: 'button', title: `不看 ${v.author} 的视频`, 'aria-label': `屏蔽 UP 主 ${v.author}`,
      onclick: (e: Event) => { e.preventDefault(); e.stopPropagation(); opts.onBlock!(v); },
    }, icon(ICONS.block), h('span', {}, '屏蔽 UP')));
  }
  const el = h('article', { class: `card${opts.compact ? ' compact' : ''}`, style: `--i:${index % 12}` },
    cover,
    h('div', { class: 'body' },
      h('a', { class: 'title', href, target: '_blank', rel: 'noopener' }, v.title),
      h('div', { class: 'meta' },
        h('a', { class: 'author', href: `https://space.bilibili.com/${v.mid}`, target: '_blank', rel: 'noopener' }, v.author),
        h('span', { class: 'dot' }, '·'),
        h('span', {}, `${fmtCount(v.views)} 播放`),
        v.pubdate && !opts.compact ? h('span', { class: 'dot' }, '·') : null,
        v.pubdate && !opts.compact ? h('span', {}, fmtAgo(v.pubdate)) : null,
      ),
      v.reason ? h('span', { class: 'reason' }, v.reason) : null,
    ),
  );
  cardData.set(el, v);
  return el;
}

export function skeleton(n: number): DocumentFragment {
  const f = document.createDocumentFragment();
  for (let i = 0; i < n; i++) f.append(h('div', { class: 'card sk' }, h('div', { class: 'cover' }), h('div', { class: 'line' }), h('div', { class: 'line short' })));
  return f;
}
