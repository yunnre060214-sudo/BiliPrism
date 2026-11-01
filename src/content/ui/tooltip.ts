import { h } from './dom';

/**
 * 21st「Tooltip」(wensity, id 31328, Base UI) 的原生移植：
 * - 悬停 400ms 后出现，离开立即消失；一个出现过后 600ms 内移到相邻控件直接出现（Provider timeout）
 * - 进场 150ms 透明度 + scale .96→1，退场 100ms；减少动态时不缩放
 * - shortcut 变体：文字后面跟键位小标（kbd）
 * - 智能定位：默认在下方，贴边时左右收进视口（collisionPadding 8）
 * 用法：给元素加 data-tip="说明"，可选 data-kbd="Ctrl K"。原有 title 会被接管成 data-tip，避免浏览器原生提示叠在一起。
 */
export function attachTooltips(root: HTMLElement, host: ParentNode = root): void {
  const tip = h('div', { class: 'tt', role: 'tooltip', 'aria-hidden': 'true' });
  host.append(tip);
  let timer = 0, closedAt = 0, cur: HTMLElement | null = null;

  const adopt = (el: Element) => {
    const t = el.getAttribute('title');
    if (t) { el.setAttribute('data-tip', t); el.removeAttribute('title'); }
  };
  root.querySelectorAll('[title]').forEach(adopt);
  new MutationObserver((ms) => ms.forEach((m) => {
    if (m.type === 'attributes') adopt(m.target as Element);
    else m.addedNodes.forEach((n) => { if (n instanceof Element) { adopt(n); n.querySelectorAll('[title]').forEach(adopt); } });
  })).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text) return;
    // 已经展开显示文字的选中项不需要再提示
    if (el.matches('[data-selected]')) return;
    const kbd = el.dataset.kbd;
    tip.replaceChildren(h('span', {}, text), ...(kbd ? [h('span', { class: 'tt-kbd' }, ...kbd.split(' ').map((k) => h('kbd', {}, k)))] : []));
    tip.setAttribute('data-open', '');
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth;
    const x = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${r.bottom + 8}px`;
    tip.style.setProperty('--ox', `${r.left + r.width / 2 - x}px`);
  };
  const hide = () => { clearTimeout(timer); if (tip.hasAttribute('data-open')) closedAt = performance.now(); tip.removeAttribute('data-open'); cur = null; };

  root.addEventListener('pointerover', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (el === cur) return;
    if (!el || !root.contains(el)) { hide(); return; }
    clearTimeout(timer);
    const warm = tip.hasAttribute('data-open') || performance.now() - closedAt < 600;
    tip.removeAttribute('data-open');
    cur = el;
    if (warm) show(el); else timer = window.setTimeout(() => show(el), 400);
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('focusin', (e) => { const el = (e.target as Element).closest<HTMLElement>('[data-tip]'); if (el && el.matches(':focus-visible')) { cur = el; show(el); } });
  root.addEventListener('focusout', hide);
  addEventListener('scroll', hide, { capture: true, passive: true });
}
