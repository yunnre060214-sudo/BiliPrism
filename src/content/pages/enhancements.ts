import { loadSettings, saveSettings, onSettingsChange, type Settings } from '../../shared/settings';
import { h } from '../ui/dom';
import { listSubtitles, downloadSubtitle, type SubtitleFormat } from '../enhancements/subtitles';
import { normalizeWheelVolumeStep, normalizePlaybackRate } from '../enhancements/values';
import css from '../enhancements/player.css?inline';

const PLAYER = '#bilibili-player-wrap, #playerWrap, #bilibili-player, #bilibiliPlayer, .bpx-player-container';
let initialized = false;
/** 单个原生播放器增强入口。没有网络拦截，也不创建第二个播放器。 */
export async function startPlayerEnhancements(): Promise<void> {
  if (initialized) return; initialized = true;
  let settings = await loadSettings();
  let media: HTMLMediaElement | null = null, anchor: HTMLElement | null = null;
  let panel: HTMLElement | null = null, observer: MutationObserver | null = null;
  let pending = 0, speedTimer = 0, wheelActive = false, accumulated = 0, lastWheel = 0;
  let applyRate = false, statusTimer = 0;
  const style = h('style', { id: 'biliprism-player-css' }, css);
  document.documentElement.append(style);
  const status = h('div', { role: 'status', 'aria-live': 'polite' });
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
  const say = (message: string) => { status.textContent = message; };
  const makePanel = () => {
    const host = h('div', { id: 'biliprism-player-tools' }), root = host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, ':host{display:block;margin:10px 0;font:12px/1.5 system-ui;color:var(--m-ink,#777)}.tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}button,select{font:inherit;color:inherit;background:transparent;border:1px solid #8885;border-radius:9px;padding:6px 10px}button{cursor:pointer}button:hover{border-color:#00aeec}button:focus-visible,select:focus-visible{outline:2px solid #00aeec}button[aria-pressed=true]{color:#00aeec}button:disabled{opacity:.5}select[hidden],button[hidden]{display:none}.tag{color:#00aeec;font-weight:600}[role=status]{flex-basis:100%;font-size:11px}'));
    const wide = h('button', { type: 'button', 'aria-pressed': String(settings.player.wide), onclick: () => {
      void saveSettings({ player: { ...settings.player, wide: !settings.player.wide } }).catch(e => say(String(e)));
    } }, '宽屏');
    const speed = h('select', { 'aria-label': '播放速度' });
    for (const rate of [.5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5])
      speed.append(h('option', { value: rate }, `${rate}×`));
    speed.value = String(settings.player.speed);
    speed.addEventListener('change', () => {
      const rate = Number(speed.value);
      if (media) media.playbackRate = rate;
      // 记忆关闭时也允许手动选速，仅不写入持久设置。
      if (settings.player.rememberSpeed) void saveSettings({ player: { ...settings.player, speed: rate } }).catch(e => say(String(e)));
    });
    const language = h('select', { 'aria-label': '字幕语言', hidden: true });
    const format = h('select', { 'aria-label': '字幕格式' });
    for (const value of ['srt', 'txt', 'json']) format.append(h('option', { value }, value.toUpperCase()));
    let info: Awaited<ReturnType<typeof listSubtitles>> | null = null, source = '', busy = false;
    const subtitle = h('button', { type: 'button', onclick: async () => {
      if (busy) return; busy = true; subtitle.disabled = true; say('正在读取字幕…');
      const url = location.href;
      try {
        if (!info || source !== url) {
          info = await listSubtitles(url); source = url;
          language.replaceChildren(...info.tracks.map((t, i) => h('option', { value: i }, t.lan_doc || t.lan)));
          language.hidden = false;
        }
        if (location.href !== url) throw new Error('视频已切换，请重新导出');
        await downloadSubtitle(info.tracks[Number(language.value) || 0], info, format.value as SubtitleFormat);
        say('字幕已导出');
      } catch (e) { say((e as Error).message || '导出失败，请重试'); }
      finally { busy = false; subtitle.disabled = false; }
    } }, '导出字幕');
    subtitle.hidden = format.hidden = !settings.player.subtitleExport;
    const tools = h('div', { class: 'tools' }, h('span', { class: 'tag' }, '映棱'), wide, speed, language, format, subtitle, status);
    root.append(tools);
    return host;
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
    if (anchor !== nextAnchor || !panel?.isConnected) {
      panel?.remove(); panel = null; anchor = nextAnchor;
      if (anchor && settings.enabled) { panel = makePanel(); anchor.after(panel); }
    }
    document.documentElement.classList.toggle('biliprism-wide', route && settings.enabled && settings.player.wide && !document.fullscreenElement);
    if (panel && !settings.enabled) { panel.remove(); panel = null; }
    if (panel) {
      const root = panel.shadowRoot!;
      root.querySelector('button')?.setAttribute('aria-pressed', String(settings.player.wide));
      const selects = root.querySelectorAll<HTMLSelectElement>('select');
      if (media) {
        const value = String(normalizePlaybackRate(media.playbackRate));
        if (![...selects[0].options].some(o => o.value === value)) selects[0].append(h('option', { value }, `${value}×`));
        selects[0].value = value;
      }
      const exportButton = root.querySelectorAll<HTMLButtonElement>('button')[1];
      exportButton.hidden = selects[2].hidden = !settings.player.subtitleExport;
      selects[1].hidden = !settings.player.subtitleExport || !selects[1].options.length;
    }
    syncWheel();
  };
  const schedule = () => { if (!pending) pending = window.setTimeout(sync, 100); };
  observer = new MutationObserver(mutations => {
    // 只响应播放器/工具条被替换的结构变化，不监听评论文本或样式变化。
    if (mutations.some(m => [...m.addedNodes, ...m.removedNodes].some(n => n instanceof Element
      && (n.matches(`${PLAYER}, video, bwp-video, #biliprism-player-tools`) || n.querySelector(`${PLAYER}, video, bwp-video`))))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('fullscreenchange', () => { syncWheel(); schedule(); });
  addEventListener('popstate', schedule); addEventListener('pagehide', () => {
    observer?.disconnect(); unbind(); clearTimeout(pending); clearTimeout(speedTimer); clearTimeout(statusTimer);
    window.removeEventListener('wheel', wheel, true);
  }, { once: true });
  onSettingsChange((next: Settings) => { settings = next; applySpeed(); sync(); });
  sync();
}
