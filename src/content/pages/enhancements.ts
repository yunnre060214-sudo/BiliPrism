import { loadSettings, saveSettings, onSettingsChange, type Settings } from '../../shared/settings';
import { h } from '../ui/dom';
import { normalizeWheelVolumeStep, normalizePlaybackRate } from '../enhancements/values';
import css from '../enhancements/player.css?inline';

const PLAYER = '#bilibili-player-wrap, #playerWrap, #bilibili-player, #bilibiliPlayer, .bpx-player-container';
let initialized = false;
/** 单个原生播放器增强入口。没有网络拦截，也不创建第二个播放器。 */
export async function startPlayerEnhancements(): Promise<void> {
  if (initialized) return; initialized = true;
  let settings = await loadSettings();
  let media: HTMLMediaElement | null = null, anchor: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let pending = 0, speedTimer = 0, wheelActive = false, accumulated = 0, lastWheel = 0;
  let applyRate = false, statusTimer = 0;
  const style = h('style', { id: 'biliprism-player-css' }, css);
  document.documentElement.append(style);
  const osd = h('div', { id: 'biliprism-volume-osd' });
  const showVolume = () => {
    if (!media) return;
    const target = document.fullscreenElement ?? anchor;
    if (!target) return;
    if (osd.parentElement !== target) target.append(osd);
    osd.textContent = `音量 ${Math.round(media.volume * 100)}%`;
    osd.hidden = false; clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => { osd.hidden = true; }, 900);
  };
  // BewlyCat fullscreenWheelVolume 的滚轮累积与可滚动区域判定，改为无 Vue 的模块生命周期。
  const scrollable = (event: WheelEvent, boundary: Element) => {
    for (const node of event.composedPath()) {
      if (node === boundary) break;
      if (!(node instanceof HTMLElement)) continue;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable) return true;
      if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) return true;
    }
    return false;
  };
  const wheel = (event: WheelEvent) => {
    const full = document.fullscreenElement;
    if (!settings.enabled || !settings.player.wheelVolume || !full || !media || !full.contains(media)
      || event.ctrlKey || event.metaKey || !event.deltaY || scrollable(event, full)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const now = performance.now();
    if (now - lastWheel > 200 || Math.sign(event.deltaY) !== Math.sign(accumulated)) accumulated = 0;
    lastWheel = now;
    accumulated += event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? event.deltaY : Math.sign(event.deltaY) * 40;
    if (Math.abs(accumulated) < 40) return;
    media.volume = Math.max(0, Math.min(1, media.volume + (accumulated < 0 ? 1 : -1) * normalizeWheelVolumeStep(settings.player.volumeStep) / 100));
    if (media.volume > 0) media.muted = false;
    accumulated = 0; showVolume();
  };
  const syncWheel = () => {
    const next = settings.enabled && settings.player.wheelVolume && !!media && !!document.fullscreenElement?.contains(media);
    if (next === wheelActive) return; wheelActive = next;
    if (next) window.addEventListener('wheel', wheel, { capture: true, passive: false });
    else { window.removeEventListener('wheel', wheel, true); accumulated = 0; osd.remove(); }
  };
  const applySpeed = () => {
    if (!media || !settings.enabled || !settings.player.rememberSpeed) return;
    const rate = normalizePlaybackRate(settings.player.speed);
    if (Math.abs(media.playbackRate - rate) < .001) return;
    applyRate = true;
    try { media.playbackRate = rate; } catch { /* Native media is not ready yet. */ }
    queueMicrotask(() => { applyRate = false; });
  };
  const rememberSpeed = () => {
    if (applyRate || !media || !settings.enabled || !settings.player.rememberSpeed) return;
    const value = normalizePlaybackRate(media.playbackRate);
    if (Math.abs(value - settings.player.speed) < .001) return;
    settings = { ...settings, player: { ...settings.player, speed: value } };
    clearTimeout(speedTimer);
    speedTimer = window.setTimeout(() => {
      void saveSettings({ player: { ...settings.player, speed: value } }).catch(() => {});
    }, 180);
  };
  const unbind = () => {
    media?.removeEventListener('loadedmetadata', applySpeed); media?.removeEventListener('ratechange', rememberSpeed);
  };
  const sync = () => {
    pending = 0;
    const route = location.hostname === 'www.bilibili.com' && /\/video\/(BV|av)/i.test(location.pathname);
    const nextAnchor = route ? document.querySelector<HTMLElement>(PLAYER) : null;
    const nextMedia = nextAnchor?.querySelector<HTMLMediaElement>('video, bwp-video') ?? null;
    if (media !== nextMedia) {
      unbind(); media = nextMedia;
      media?.addEventListener('loadedmetadata', applySpeed); media?.addEventListener('ratechange', rememberSpeed);
      applySpeed();
    }
    anchor = nextAnchor;
    document.documentElement.classList.toggle('biliprism-wide', route && settings.enabled && settings.player.wide && !document.fullscreenElement);
    syncWheel();
  };
  const schedule = () => { if (!pending) pending = window.setTimeout(sync, 100); };
  observer = new MutationObserver(mutations => {
    // 只响应播放器/工具条被替换的结构变化，不监听评论文本或样式变化。
    if (mutations.some(m => [...m.addedNodes, ...m.removedNodes].some(n => n instanceof Element
      && (n.matches(`${PLAYER}, video, bwp-video`) || n.querySelector(`${PLAYER}, video, bwp-video`))))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('fullscreenchange', () => { syncWheel(); schedule(); });
  addEventListener('popstate', schedule);
  addEventListener('pageshow', event => { if (event.persisted) { void loadSettings().then(next => { settings = next; applySpeed(); sync(); }); } });
  addEventListener('pagehide', event => {
    if (event.persisted) return;
    observer?.disconnect(); unbind(); clearTimeout(pending); clearTimeout(speedTimer); clearTimeout(statusTimer);
    window.removeEventListener('wheel', wheel, true);
  });
  onSettingsChange((next: Settings) => { settings = next; applySpeed(); sync(); });
  sync();
}
