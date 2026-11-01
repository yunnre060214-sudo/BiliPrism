// Adapted from BewlyCat src/utils/{wheelVolume,playbackRate}.ts.
// Copyright Keleus / Hakadao; see licenses/BewlyCat-LICENSE.txt.
export function normalizeWheelVolumeStep(value: unknown): number {
  const step = typeof value === 'number' && Number.isFinite(value) ? value : 5;
  return Math.round(Math.max(1, Math.min(50, step)));
}
export function normalizePlaybackRate(value: unknown): number {
  const rate = typeof value === 'number' && Number.isFinite(value) ? value : 1;
  return Math.round(Math.max(0.25, Math.min(5, rate)) * 100) / 100;
}
