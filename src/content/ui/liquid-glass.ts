/** 保留上游调用接口，使用普通高斯模糊，无位移图、Canvas 或 ResizeObserver。 */
export interface GlassOpts { blur?: number; strength?: number; sat?: string }
export function attachGlass(el: HTMLElement, _filters: SVGSVGElement, o: GlassOpts = {}): void {
  el.style.backdropFilter = `blur(${Math.min(o.blur ?? 12, 16)}px)`;
}
export function glassFilters(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('data-prism-filters', '');
  svg.style.cssText = 'display:none';
  return svg;
}
export function filtersIn(root: ShadowRoot): SVGSVGElement {
  return root.querySelector<SVGSVGElement>('svg[data-prism-filters]') ?? root.appendChild(glassFilters());
}
