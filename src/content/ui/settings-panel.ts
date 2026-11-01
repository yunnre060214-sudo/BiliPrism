import type { BgMode, Settings, ShaderId, Theme } from '../../shared/settings';
import { BG_IMAGE_KEY, replaceSettings, sanitizeSettings, saveSettings } from '../../shared/settings';
import { ACTIVITY_KEY, sanitizeActivity, type FpMessage } from '../../shared/activity';
import { compressImage } from '../bg/background';
import { SHADER_IDS, SHADER_NAMES } from '../bg/shaders';
import { block, chipInput, rangeSlider, row, segmented, stepSlider, toast, toggle } from './controls';
import { fmtCount, h, icon, ICONS } from './dom';
import { createSheet, type Sheet } from './sheet';

export interface SettingsPanel { sheet: Sheet; sync(s: Settings): void }

export function createSettingsPanel(get: () => Settings, currentShader: () => ShaderId | null): SettingsPanel {
  const sheet = createSheet({ title: '设置', eyebrow: 'Preferences', width: 420 });
  const save = (patch: Partial<Settings>) => saveSettings(patch);
  const s0 = get();

  const commentTree = toggle(s0.commentTree, '树状评论楼层', v => save({ commentTree: v }));
  const theme = segmented<Theme>([['auto', '跟随系统'], ['light', '亮色'], ['dark', '暗色']], s0.theme, (v) => save({ theme: v }));
  const watch = toggle(s0.watch, '其他页面重设计', (v) => save({ watch: v }));
  const preview = toggle(s0.hoverPreview, '悬停预览', (v) => save({ hoverPreview: v }));
  const intro = toggle(s0.intro, '开场动画', (v) => save({ intro: v }));
  const foot = toggle(s0.footprint, '足迹热力图', (v) => save({ footprint: v }));
  const wxT = toggle(s0.weather, '天气', (v) => save({ weather: v }));
  const favD = toggle(s0.favDirect, '收藏夹直接展开', (v) => save({ favDirect: v }));

  const playerSave = (patch: Partial<Settings['player']>) => save({ player: { ...get().player, ...patch } });
  const wheel = toggle(s0.player.wheelVolume, '全屏滚轮调音', v => playerSave({ wheelVolume: v }));
  const speed = toggle(s0.player.rememberSpeed, '记忆播放速度', v => playerSave({ rememberSpeed: v }));
  const wide = toggle(s0.player.wide, '宽屏布局', v => playerSave({ wide: v }));
  const subtitle = toggle(s0.player.subtitleExport, '字幕导出', v => playerSave({ subtitleExport: v }));
  const step = segmented<string>([['1','1%'], ['5','5%'], ['10','10%']], String(s0.player.volumeStep), v => playerSave({ volumeStep: Number(v) }));

  const kw = chipInput(s0.filters.keywords, '输入关键词，回车添加；/正则/ 也可以', (v) => save({ filters: { ...get().filters, keywords: v } }));
  const ups = chipInput(s0.filters.ups, 'UP 主昵称或 MID', (v) => save({ filters: { ...get().filters, ups: v } }));
  const views = stepSlider([0, 1000, 10000, 50000, 100000, 1000000], s0.filters.minViews, (n) => (n ? `≥ ${fmtCount(n)}` : '不限'), (v) => save({ filters: { ...get().filters, minViews: v } }), '最低播放量');
  const dur = segmented<string>([['0', '不限'], ['60', '1 分钟'], ['180', '3 分钟'], ['600', '10 分钟']], String(s0.filters.minDuration), (v) => save({ filters: { ...get().filters, minDuration: Number(v) } }));

  const mode = segmented<BgMode>([['random', '随机'], ['fixed', '固定'], ['image', '图片'], ['off', '关闭']], s0.bg.mode, (v) => {
    if (v === 'image') { file.click(); return; }
    save({ bg: { ...get().bg, mode: v } });
  });
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': '背景样式' });
  const paintSwatches = () => {
    const s = get();
    const on = s.bg.mode === 'fixed' ? s.bg.shader : s.bg.mode === 'random' ? currentShader() : null;
    swatches.querySelectorAll<HTMLElement>('.sw-item').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === on)));
  };
  for (const id of SHADER_IDS) {
    const b = h('button', { type: 'button', class: 'sw-item', role: 'radio', onclick: () => save({ bg: { ...get().bg, mode: 'fixed', shader: id } }) },
      h('span', { class: `sw-chip sw-${id}`, 'data-id': id }), h('span', {}, SHADER_NAMES[id]));
    b.dataset.v = id;
    swatches.append(b);
  }
  const intensity = rangeSlider(s0.bg.intensity, (n) => `${Math.round(n * 100)}%`, (v) => save({ bg: { ...get().bg, intensity: v } }), '背景强度');
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-label': '选择背景图片' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) { mode.set(get().bg.mode); return; }
    try {
      const url = await compressImage(f);
      await chrome.storage.local.set({ [BG_IMAGE_KEY]: url });
      await save({ bg: { ...get().bg, mode: 'image' } });
    } catch (e) { say((e as Error).message || '图片处理失败'); mode.set(get().bg.mode); }
  });
  const upload = h('button', { type: 'button', class: 'ghost small', onclick: () => file.click() }, icon(ICONS.image), h('span', {}, '上传图片'));

  // ── 数据：导出 / 导入设置与足迹（JSON 文件，只在本机处理） ──
  const say = (t: string) => toast((sheet.el.closest('.app') as HTMLElement | null) ?? sheet.el, t);
  const exportData = async () => {
    const v = await chrome.storage.local.get(ACTIVITY_KEY);
    const data = { app: 'biliprism', format: 1, version: chrome.runtime.getManifest().version, exportedAt: new Date().toISOString(), settings: get(), activity: v[ACTIVITY_KEY] ?? {} };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `biliprism-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    say(`已导出设置和 ${Object.keys(data.activity).length} 天足迹`);
  };
  const json = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': '选择要导入的备份文件' });
  json.addEventListener('change', async () => {
    const f = json.files?.[0];
    json.value = '';
    if (!f) return;
    let raw: Record<string, unknown>;
    try {
      if (f.size > 5e6) throw new Error('文件太大');
      raw = JSON.parse(await f.text());
      if (!raw || typeof raw !== 'object' || raw.app !== 'biliprism') throw new Error('不是映棱导出的备份文件');
    } catch (e) { say(`导入失败：${(e as Error).message || '文件格式不对'}`); return; }
    const settings = raw.settings === undefined ? null : sanitizeSettings(raw.settings);
    const activity = raw.activity === undefined ? null : sanitizeActivity(raw.activity);
    if (!settings && !activity) { say('导入失败：备份里没有可用的设置或足迹'); return; }
    const days = activity ? Object.keys(activity).length : 0;
    const parts = [settings ? '用备份覆盖当前设置（主题、背景、过滤）' : '', days ? `合并 ${days} 天足迹（同一天取较长时长、较早首次打开）` : ''].filter(Boolean);
    const when = typeof raw.exportedAt === 'string' ? `（${raw.exportedAt.slice(0, 10)} 导出）` : '';
    if (!confirm(`导入映棱备份${when}：\n· ${parts.join('\n· ')}\n\n继续吗？`)) return;
    if (activity && days) await chrome.runtime.sendMessage({ margin: 'fp', op: 'import', days: activity } satisfies FpMessage);
    if (settings) await replaceSettings(settings);
    say(`已导入${settings ? '设置' : ''}${settings && days ? '和' : ''}${days ? ` ${days} 天足迹` : ''}`);
  });
  const exportBtn = h('button', { type: 'button', class: 'ghost small', onclick: exportData }, h('span', {}, '导出'));
  const importBtn = h('button', { type: 'button', class: 'ghost small', onclick: () => json.click() }, h('span', {}, '导入'));

  sheet.body.append(
    h('section', { class: 'group' }, h('h3', {}, '外观'),
      block('明暗', null, theme),
      row('封面悬停预览', '鼠标停留半秒后静音播放', preview),
      row('开场动画', '短开场，点一下可跳过；默认关闭', intro),
      row('其他页面重设计', '播放页、搜索页、空间、动态等，只换外观不改功能', watch),
      row('收藏夹直接展开', '点收藏夹直接列出全部视频，不再先弹出最近 4 个', favD)),
    h('section', { class: 'group' }, h('h3', {}, '首页顶部'),
      row('足迹热力图', '关掉只是不显示，足迹照样在本机记录', foot),
      row('天气', '关掉后不再请求天气和城市定位', wxT)),
    h('section', { class: 'group' }, h('h3', {}, '背景'),
      block('模式', '静态渐变，不持续绘制；随机模式每次打开选择配色', mode),
      block('样式', null, swatches),
      block('强度', null, intensity),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('span', {}, '自定义图片'), h('small', {}, '压缩后只保存在本机')), upload, file)),
    h('section', { class: 'group' }, h('h3', {}, '播放器增强'),
      row('全屏滚轮调音', '仅在全屏时接管滚轮；保留菜单和列表滚动', wheel),
      block('音量步长', null, step),
      row('记忆播放速度', '沿用你在播放器选择的速度', speed),
      row('宽屏布局', '扩大视频区域并把推荐列表放到下方', wide),
      row('字幕导出', 'Ctrl / ⌘ + K 打开命令面板，选择「导出字幕」', subtitle)),
    h('section', { class: 'group' }, h('h3', {}, '评论区'), row('树状评论楼层', 'BewlyCat 树状层级、连线与分支折叠；保留原生回复与翻页', commentTree)),
    h('section', { class: 'group' }, h('h3', {}, '推荐过滤'),
      block('屏蔽关键词', '标题包含即隐藏', kw),
      block('屏蔽 UP 主', '卡片右上角也能一键屏蔽', ups),
      block('最低播放量', null, views),
      block('最短时长', null, dur)),
    h('section', { class: 'group' }, h('h3', {}, '数据'),
      h('div', { class: 'row' }, h('div', { class: 'row-label' }, h('span', {}, '备份与迁移'), h('small', {}, '设置和足迹导出成 JSON 文件；不含自定义背景图片')),
        h('div', { class: 'data-acts' }, exportBtn, importBtn), json)),
  );

  return {
    sheet,
    sync(s) {
      theme.set(s.theme);
      commentTree.setAttribute('aria-checked', String(s.commentTree));
      wheel.setAttribute('aria-checked', String(s.player.wheelVolume));
      speed.setAttribute('aria-checked', String(s.player.rememberSpeed));
      wide.setAttribute('aria-checked', String(s.player.wide));
      subtitle.setAttribute('aria-checked', String(s.player.subtitleExport));
      step.set(String(s.player.volumeStep));
      preview.setAttribute('aria-checked', String(s.hoverPreview));
      intro.setAttribute('aria-checked', String(s.intro));
      watch.setAttribute('aria-checked', String(s.watch));
      foot.setAttribute('aria-checked', String(s.footprint));
      wxT.setAttribute('aria-checked', String(s.weather));
      favD.setAttribute('aria-checked', String(s.favDirect));
      kw.set(s.filters.keywords);
      ups.set(s.filters.ups);
      mode.set(s.bg.mode);
      paintSwatches();
    },
  };
}
