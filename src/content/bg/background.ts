import { BG_IMAGE_KEY, type Background, type Palette, type ShaderId } from '../../shared/settings';
import { h } from '../ui/dom';
import { SHADER_IDS } from './shaders';
const COLORS: Record<ShaderId, [string, string]> = {
  aurora: ['#68adcf', '#9f7ad0'], silk: ['#86b8ba', '#cba996'], mesh: ['#a4a2dc', '#78bfae'],
  grain: ['#c7a28c', '#b4ae91'], ice: ['#5cb4df', '#96ace2'], veil: ['#c6aec2', '#99b4bb'],
  smoke: ['#a9b3c5', '#bba8d3'], neuro: ['#79b39a', '#7295c7'], flow: ['#92b9cf', '#d7b5a2'],
  rays: ['#cbbd86', '#8cabc3'], blend: ['#c0b0ce', '#98b2d4'], flux: ['#779fec', '#bd9cdb'], gate: ['#5da3be', '#c0a9db'],
};
/** 静态 CSS 背景，无 WebGL/WebGPU、持续绘制或指针透镜。 */
export class BackgroundLayer {
  readonly el = h('div', { class: 'bg', 'aria-hidden': 'true' });
  private current: ShaderId | null = null;
  private random = SHADER_IDS[Math.floor(Math.random() * SHADER_IDS.length)];
  private generation = 0;
  get shader(): ShaderId | null { return this.current; }
  async apply(cfg: Background, theme: 'light' | 'dark', _palette: Palette = 'classic'): Promise<void> {
    const gen = ++this.generation;
    this.el.dataset.mode = cfg.mode; this.el.style.opacity = String(cfg.intensity);
    this.el.style.background = 'none'; this.current = null;
    if (cfg.mode === 'off') return;
    if (cfg.mode === 'image') {
      const data = (await chrome.storage.local.get(BG_IMAGE_KEY))[BG_IMAGE_KEY];
      if (gen !== this.generation) return;
      if (typeof data === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(data))
        this.el.style.background = `center / cover no-repeat url("${data}")`;
      return;
    }
    this.current = cfg.mode === 'random' ? this.random : cfg.shader;
    const [a, b] = COLORS[this.current] ?? COLORS.aurora;
    const alpha = theme === 'dark' ? '30' : '38';
    this.el.style.background = `radial-gradient(ellipse at 12% 5%, ${a}${alpha}, transparent 62%), radial-gradient(ellipse at 90% 35%, ${b}${alpha}, transparent 65%)`;
  }
  setLens(_el: HTMLElement | null): void {}
  setFocus(_el: HTMLElement | null): void {}
  redraw(): void {}
}
export async function compressImage(file: File): Promise<string> {
  if (file.size > 20_000_000) throw new Error('请选择 20 MB 以内的图片');
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d'); if (!ctx) throw new Error('无法处理这张图片');
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally { bmp.close(); }
}
