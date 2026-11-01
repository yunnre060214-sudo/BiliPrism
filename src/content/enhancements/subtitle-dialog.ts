import { loadSettings } from '../../shared/settings';
import { h } from '../ui/dom';
import { listSubtitles, downloadSubtitle, type SubtitleFormat } from './subtitles';
let current: HTMLElement | null = null;
/** 只从命令面板按需打开，宿主始终位于原生应用树之外。 */
export async function openSubtitleExport(): Promise<void> {
  current?.remove();
  const settings = await loadSettings();
  const host = h('div', { id: 'biliprism-subtitle-dialog' }), root = host.attachShadow({ mode: 'open' });
  const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
  root.append(h('style', {}, `:host{color-scheme:${dark ? 'dark' : 'light'}}dialog{max-width:min(460px,calc(100vw - 48px));border:1px solid #8885;border-radius:18px;padding:24px;background:${dark ? '#20232a' : '#fff'};color:${dark ? '#ededee' : '#252830'};font:14px/1.5 system-ui}dialog::backdrop{background:#0005}h2{font-size:18px;margin:0 0 16px}label{display:flex;justify-content:space-between;align-items:center;gap:24px;margin:12px 0}select,button{font:inherit;padding:8px 12px;border:1px solid #8885;border-radius:8px;background:transparent;color:inherit}button{cursor:pointer}.actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px}[role=status]{font-size:12px;max-width:380px}`));
  const dialog = h('dialog', { 'aria-label': '导出字幕' });
  const lang = h('select', { 'aria-label': '字幕语言' });
  const format = h('select', { 'aria-label': '字幕格式' }, ...(['srt', 'txt', 'json'] as const).map(v => h('option', { value: v }, v.toUpperCase())));
  const status = h('p', { role: 'status' }, '正在读取字幕…');
  const download = h('button', { type: 'button', disabled: true }, '下载字幕');
  const close = h('button', { type: 'button', onclick: () => dialog.close() }, '关闭');
  dialog.append(h('h2', {}, '导出字幕'), h('label', {}, '语言', lang), h('label', {}, '格式', format), status, h('div', { class: 'actions' }, close, download));
  root.append(dialog); document.documentElement.append(host); current = host;
  dialog.addEventListener('close', () => { host.remove(); if (current === host) current = null; });
  dialog.showModal();
  if (!settings.enabled || !settings.player.subtitleExport) { status.textContent = '请先在设置中启用字幕导出'; return; }
  const source = location.href;
  try {
    const info = await listSubtitles(source);
    if (!host.isConnected) return;
    lang.replaceChildren(...info.tracks.map((t, i) => h('option', { value: i }, t.lan_doc || t.lan)));
    status.textContent = ''; download.disabled = false;
    download.addEventListener('click', async () => {
      download.disabled = true;
      try {
        if (source !== location.href) throw new Error('视频已切换，请关闭后重新导出');
        await downloadSubtitle(info.tracks[Number(lang.value) || 0], info, format.value as SubtitleFormat);
        status.textContent = '字幕已导出';
      } catch (e) { status.textContent = (e as Error).message; }
      finally { download.disabled = false; }
    });
  } catch (e) { status.textContent = (e as Error).message || '字幕读取失败'; }
}
