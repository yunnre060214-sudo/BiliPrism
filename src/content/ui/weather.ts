import { every } from '../sched';
import { introActive } from './intro/gate';
import { appendMarkup, h } from './dom';
import { weather, geocode, setLoc, savedLoc, type Wx } from '../api/weather';
import { WEATHER_SKIES, WEATHER_SKY_LAYERS, moonAge, weatherScene, glyphSvg, SKY_PITCH, FRAME } from './dotsky';

/**
 * 首页天气卡：21st「Weather Widget」（vijayksingh）的横版排法——
 * 左边下沉的点阵天空（太阳按当地钟点走弧线、夜里月相 + 星星、云雨雪雾风都会动），地面上放像素体温度和天气；
 * 右边城市 + Live 指示灯 + 当地时钟，未来 6 个时段（每 3 小时），再下面 3 天的低温→高温点条。
 * 点城市名可以改城市。动画只在卡片可见、页面没在滚动、没开「减少动态效果」时跑。
 */

const GRID = { cols: 30, rows: 26, horizon: 19 };
const deg = (n: number) => `${Math.round(n)}°`;

export function createWeather(): HTMLElement {
  const el = h('section', { class: 'wx', 'aria-label': '天气' });
  el.append(h('div', { class: 'wx-sky sk' }), h('div', { class: 'wx-side' }));
  let wx: Wx | null = null;
  let tick = 0, visible = false;
  let stop: (() => void) | null = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const localHour = () => {
    const d = new Date(Date.now() + (wx?.offset ?? 0) * 1000);
    return d.getUTCHours() + d.getUTCMinutes() / 60;
  };
  const clock = () => {
    const d = new Date(Date.now() + (wx?.offset ?? 0) * 1000);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${GRID.cols * SKY_PITCH} ${GRID.rows * SKY_PITCH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMax slice');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  // 每层一个固定的 <path>，每帧只改变了的 d：以前整段 innerHTML 重写，6 次/秒重建节点 + 重新布局
  const layers = new Map<string, SVGPathElement>();
  for (const l of WEATHER_SKY_LAYERS) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', `s-${l}`);
    layers.set(l, path); svg.append(path);
  }
  const paint = () => {
    if (!wx) return;
    const p = weatherScene({ ...GRID, hour: localHour(), sky: { ...WEATHER_SKIES[wx.kind], moonPhase: moonAge(new Date()) }, tick }) as unknown as Record<string, string>;
    for (const [l, path] of layers) {
      const d = p[l] || '';
      if (path.getAttribute('d') !== d) { if (d) path.setAttribute('d', d); else path.removeAttribute('d'); }
    }
  };
  const clockEl = h('span', { class: 'wx-clock' });
  const run = () => {
    stop?.(); stop = null;
    const app = el.closest('.app');
    if (!wx || !visible || reduced.matches || document.hidden) return;
    stop = every(FRAME, () => {
      if (app?.classList.contains('scrolling') || introActive()) return;
      tick++; paint();
      if (tick % 60 === 0) clockEl.textContent = clock();
    });
  };
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(el);
  document.addEventListener('visibilitychange', run);

  const editCity = (place: HTMLElement) => {
    const input = h('input', { class: 'wx-city-in', value: wx?.loc.name ?? '', 'aria-label': '城市', placeholder: '输入城市' }) as HTMLInputElement;
    const done = async (ok: boolean) => {
      const q = input.value.trim();
      if (ok && q && q !== wx?.loc.name) {
        input.disabled = true;
        try {
          const loc = await geocode(q);
          if (loc) { setLoc(loc); load(); return; }
          input.disabled = false; input.select(); input.classList.add('bad'); return;
        } catch { /* 网络失败就恢复原样 */ }
      }
      input.replaceWith(place);
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true));
    place.replaceWith(input);
    input.focus(); input.select();
  };

  const render = () => {
    if (!wx) return;
    const w = wx;
    const sky = h('div', { class: 'wx-sky', role: 'img', 'aria-label': `${w.loc.name}：${w.condition}，${deg(w.temp)}` },
      svg,
      h('div', { class: 'wx-now' },
        h('span', { class: 'wx-temp' }, deg(w.temp)),
        h('span', { class: 'wx-cond' }, w.condition)));
    const place = h('button', { class: 'wx-city', type: 'button', title: '点击更换城市' }, w.loc.name);
    place.onclick = () => editCity(place);
    clockEl.textContent = clock();
    const hours = h('ol', { class: 'wx-hours', 'aria-label': '未来几个时段' },
      ...w.hours.map((x) => {
        const li = h('li', { 'aria-label': `${x.label} ${deg(x.temp)}` }, h('span', { class: 'wx-hl' }, x.label));
        appendMarkup(li, glyphSvg(x.kind, x.hour));
        li.append(h('b', {}, deg(x.temp)));
        return li;
      }));
    // 3 天：低温→高温点条，共用一个刻度（原 Weather.Week）
    const days = w.days.slice(0, 3);
    const lo = Math.floor(Math.min(...days.map((d) => d.low), w.temp));
    const hi = Math.ceil(Math.max(...days.map((d) => d.high), w.temp));
    const span = Math.max(1, Math.min(20, hi - lo));
    const bar = (low: number, high: number, now?: number) => {
      let off = '', lit = '', cur = '';
      for (let t = lo; t <= lo + span; t++) {
        const d = `M${(t - lo) * 8 + 1} 0h6v6h-6Z`;
        if (now !== undefined && t === Math.round(now)) cur += d;
        else if (t >= Math.round(low) && t <= Math.round(high)) lit += d;
        else off += d;
      }
      return `<svg class="wx-bar" viewBox="0 0 ${(span + 1) * 8} 6" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true"><path class="b-off" d="${off}"/><path class="b-lit" d="${lit}"/><path class="b-now" d="${cur}"/></svg>`;
    };
    const week = h('ul', { class: 'wx-week', 'aria-label': '未来三天' },
      ...days.map((d, i) => {
        const li = h('li', { 'aria-label': `${d.name} ${deg(d.low)} 到 ${deg(d.high)}`, 'data-kind': d.kind }, h('span', { class: 'wx-dn' }, d.name));
        appendMarkup(li, glyphSvg(d.kind));
        li.append(h('span', { class: 'wx-lo' }, deg(d.low)));
        appendMarkup(li, bar(d.low, d.high, i === 0 ? w.temp : undefined));
        li.append(h('span', { class: 'wx-hi' }, deg(d.high)));
        return li;
      }));
    const side = h('div', { class: 'wx-side' },
      h('header', { class: 'wx-head' },
        h('div', { class: 'wx-place' }, place, h('small', {}, `体感 ${deg(w.feels)} · 降水 ${w.rainPct}% · ${Math.round(w.wind)} km/h`)),
        h('div', { class: 'wx-live' }, h('i', { class: 'wx-led' }), h('span', {}, 'Live'), clockEl)),
      hours, week);
    el.replaceChildren(sky, side);
    paint();
    run();
  };

  let tries = 0;
  const load = () => {
    weather().then((x) => { wx = x; render(); }).catch((err) => {
      console.warn('[margin] weather', err);
      if (tries++ < 2) { setTimeout(load, 4000 * tries); return; }
      el.replaceChildren(h('p', { class: 'wx-empty', title: String(err) }, `天气暂时取不到${savedLoc()?.name ? `（${savedLoc()!.name}）` : ''}`));
    });
  };
  load();
  return el;
}
