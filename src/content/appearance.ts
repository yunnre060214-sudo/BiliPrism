import type { Settings } from '../shared/settings';

/** Custom properties inherit through every extension and native comment shadow root. */
export function publishAppearance(s: Settings, active: boolean): void {
  const root = document.documentElement, a = s.appearance;
  root.dataset.biliprismAppearance = String(active);
  root.dataset.biliprismSolid = String(active && a.solidSurfaces);
  root.dataset.biliprismMotion = active && a.reduceMotion ? 'reduce' : 'auto';
  const values: Record<string, string> = {
    '--bp-font-size': `${a.fontSize}px`, '--bp-meta-size': `${Math.max(13, a.fontSize - 1)}px`,
    '--bp-font-weight': String(a.fontWeight), '--bp-line-height': String(a.lineHeight),
    '--bp-accent': a.accent, '--bp-radius': `${a.radius}px`,
    '--bp-tree-step': String(s.comments.indent), '--bp-tree-width': String(s.comments.lineWidth),
  };
  for (const [key, value] of Object.entries(values)) {
    if (!active) root.style.removeProperty(key);
    else if (root.style.getPropertyValue(key) !== value) root.style.setProperty(key, value);
  }
  root.dataset.biliprismComments = JSON.stringify(s.comments);
}
