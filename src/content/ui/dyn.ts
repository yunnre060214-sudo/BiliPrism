import type { Dyn } from '../api/dyn';
import { fmtAgo, fmtCount, h, icon, ICONS } from './dom';

const img = (src: string, w: number, hgt?: number) => h('img', { src: src ? `${src}@${w}w${hgt ? `_${hgt}h_1c` : ''}.webp` : '', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
const ext = { target: '_blank', rel: 'noopener' };

/** 动态卡：杂志式单栏。日期眉标 + 正文 + 媒体（视频横卡 / 图片网格 / 专栏）+ 等宽统计 */
export function dynCard(d: Dyn, nested = false, withAuthor = false): HTMLElement {
  const media: (Node | null)[] = [];
  if (d.video) {
    media.push(h('a', { class: 'dy-video', href: `https://www.bilibili.com/video/${d.video.bvid}`, ...ext },
      h('span', { class: 'dy-vcover' }, img(d.video.cover, 480, 270), d.video.dur ? h('span', { class: 'dur' }, d.video.dur) : null),
      h('span', { class: 'dy-vbody' },
        h('span', { class: 'dy-vtitle' }, d.video.title),
        d.video.desc ? h('span', { class: 'dy-vdesc' }, d.video.desc) : null,
        h('span', { class: 'dy-vmeta' }, d.video.play ? `${d.video.play} 播放` : 'VIDEO'))));
  }
  if (d.pics.length) {
    const n = Math.min(d.pics.length, 9);
    media.push(h('div', { class: `dy-pics n${n === 1 ? 1 : n <= 4 && n !== 3 ? 2 : 3}` },
      ...d.pics.slice(0, 9).map((p, i) => h('a', { href: p, 'aria-label': `查看第 ${i + 1} 张图`, ...ext }, img(p, n === 1 ? 720 : 360, n === 1 ? undefined : 360)))));
  }
  if (d.article) {
    media.push(h('a', { class: 'dy-article', href: d.article.url, ...ext },
      d.article.cover ? img(d.article.cover, 320, 200) : null,
      h('span', {}, h('b', {}, d.article.title), h('span', {}, d.article.desc))));
  }
  if (d.orig) media.push(h('div', { class: 'dy-orig' }, h('div', { class: 'dy-orig-by' }, `@${d.orig.author}`), dynCard(d.orig, true)));

  const body = h('div', { class: 'dy-body' },
    d.title ? h('h3', { class: 'dy-title' }, d.title) : null,
    d.text ? h('p', { class: 'dy-text' }, d.text) : null,
    ...media);
  if (nested) return h('div', { class: 'dy nested' }, body);
  const open = () => h('a', { class: 'dy-open', href: d.url, ...ext, title: '查看详情' }, icon(ICONS.arrow));
  // 动态首页：21st SocialPostCard 的作者行（头像 · 名字 · 时间/类型），空间页作者固定所以只留眉标
  const by = withAuthor ? h('div', { class: 'dy-by' },
    h('a', { class: 'dy-by-face', href: `https://space.bilibili.com/${d.mid}`, 'aria-label': `${d.author} 的个人空间`, ...ext }, h('img', { src: d.face ? `${d.face}@80w_80h_1c.webp` : '', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })),
    h('div', { class: 'dy-by-b' },
      h('a', { class: 'dy-by-name', href: `https://space.bilibili.com/${d.mid}`, ...ext }, d.author),
      h('div', { class: 'dy-eyebrow' }, h('span', {}, d.ts ? fmtAgo(d.ts) : d.time), h('span', { class: 'dy-kind' }, kindLabel(d)))),
    open()) : null;
  return h('article', { class: withAuthor ? 'dy with-by' : 'dy' },
    by ?? h('div', { class: 'dy-eyebrow' },
      h('span', {}, d.ts ? fmtAgo(d.ts) : d.time),
      h('span', { class: 'dy-kind' }, kindLabel(d)),
      h('a', { class: 'dy-open', href: d.url, ...ext, title: '查看详情' }, icon(ICONS.arrow))),
    body,
    h('div', { class: 'dy-stat' },
      h('span', {}, `转发 ${fmtCount(d.stat.forward)}`),
      h('span', {}, `评论 ${fmtCount(d.stat.comment)}`),
      h('span', {}, `赞 ${fmtCount(d.stat.like)}`)));
}

function kindLabel(d: Dyn): string {
  if (d.orig) return 'REPOST';
  if (d.video) return 'VIDEO';
  if (d.article) return 'ARTICLE';
  if (d.pics.length) return 'PHOTO';
  return 'NOTE';
}
