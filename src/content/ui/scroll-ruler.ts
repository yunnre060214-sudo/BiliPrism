import { h } from './dom';

/**
 * 刻度尺滚动进度：21st「Scroll Bars」（radiumcoders）竖向版的原生移植。
 * 51 根刻度、每 5 根一根长刻度，刻度入场是弹簧（damping 12 / stiffness 120）逐根长出；
 * 指示条跟随滚动进度，弹簧 stiffness 200 / damping 20。
 * 只在滚动时和悬停时出现；点刻度跳到那个位置。
 */
const COUNT = 51, MAJOR = 5, GAP = 5;

export function createScrollRuler(): HTMLElement {
  const ticks = Array.from({ length: COUNT }, (_, i) => h('i', { class: i % MAJOR === 0 ? 'major' : '', style: `--d:${i * 8}ms` }));
  const ind = h('b', { class: 'sr-ind' });
  const pct = h('span', { class: 'sr-pct' }, '0%');
  const track = h('div', { class: 'sr-track' }, ...ticks, ind, pct);
  const el = h('div', { class: 'sr', 'aria-hidden': 'true', 'data-on': 'false' }, track);
  const H = (COUNT - 1) * GAP;

  let y = 0, v = 0, target = 0, raf = 0, last = 0, idle = 0;
  const progress = () => { const max = document.documentElement.scrollHeight - innerHeight; return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0; };
  const tick = (t: number) => {
    let dt = Math.min(0.05, (t - last) / 1000); last = t;
    while (dt > 0) { const s = Math.min(dt, 1 / 120); dt -= s; const a = -200 * (y - target) - 20 * v; v += a * s; y += v * s; }
    ind.style.transform = `translateY(${y}px)`; pct.style.transform = `translateY(${y}px)`;
    const near = Math.round(y / GAP);
    ticks.forEach((tk, i) => tk.classList.toggle('lit', Math.abs(i - near) <= 1));
    if (Math.abs(y - target) < 0.05 && Math.abs(v) < 0.05) { raf = 0; return; }
    raf = requestAnimationFrame(tick);
  };
  const update = () => {
    const p = progress();
    target = p * H; pct.textContent = `${Math.round(p * 100)}%`;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { y = target; v = 0; }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  };
  const show = () => {
    el.dataset.on = 'true';
    clearTimeout(idle);
    idle = window.setTimeout(() => { if (!el.matches(':hover')) el.dataset.on = 'false'; }, 1400);
  };
  addEventListener('scroll', () => { if (scrollY < 40) { el.dataset.on = 'false'; update(); return; } update(); show(); }, { passive: true });
  el.addEventListener('pointerenter', () => { clearTimeout(idle); el.dataset.on = 'true'; });
  el.addEventListener('pointerleave', () => show());
  track.addEventListener('click', (e) => {
    const r = track.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientY - r.top - 0) / H));
    scrollTo({ top: p * (document.documentElement.scrollHeight - innerHeight), behavior: 'smooth' });
  });
  update();
  return el;
}
