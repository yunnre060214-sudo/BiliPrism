export type Theme = 'auto' | 'light' | 'dark';
/** 只保留经典配色（雾蓝 / 夜蓝已按用户要求移除） */
export type Palette = 'classic';
export type ShaderId = 'aurora' | 'silk' | 'mesh' | 'grain' | 'ice' | 'veil' | 'smoke' | 'neuro' | 'flow' | 'rays' | 'blend' | 'flux' | 'gate';
export type BgMode = 'random' | 'fixed' | 'image' | 'off';

export interface Filters {
  /** 标题关键词；写成 /正则/ 时按正则匹配 */
  keywords: string[];
  /** UP 主昵称或 MID */
  ups: string[];
  minViews: number;
  /** 秒 */
  minDuration: number;
}

export interface Background {
  mode: BgMode;
  shader: ShaderId;
  /** 0–1 */
  intensity: number;
}

export interface PlayerSettings {
  wheelVolume: boolean;
  volumeStep: number;
  rememberSpeed: boolean;
  speed: number;
  wide: boolean;
  subtitleExport: boolean;
}

export interface Settings {
  player: PlayerSettings;
  enabled: boolean;
  theme: Theme;
  palette: Palette;
  hoverPreview: boolean;
  /** 重新设计视频播放页（保留 B 站原生播放器与评论） */
  watch: boolean;
  /** 首页开场动画（每次打开浏览器后首次进入首页播放一次） */
  intro: boolean;
  /** 首页顶部「B 站足迹」热力图（关掉只是不显示，后台照样记录） */
  footprint: boolean;
  /** 首页顶部天气卡（关掉就不请求天气和定位） */
  weather: boolean;
  /** 点收藏夹直接展开全部视频（关掉时先扇形弹出最近 4 个） */
  favDirect: boolean;
  filters: Filters;
  bg: Background;
}

export const DEFAULTS: Settings = {
  player: { wheelVolume: true, volumeStep: 5, rememberSpeed: true, speed: 1, wide: false, subtitleExport: true },
  enabled: true,
  theme: 'auto',
  palette: 'classic',
  hoverPreview: false,
  watch: true,
  intro: false,
  footprint: true,
  weather: false,
  favDirect: false,
  filters: { keywords: [], ups: [], minViews: 0, minDuration: 0 },
  bg: { mode: 'fixed', shader: 'aurora', intensity: 0.6 },
};

const KEY = 'biliprism:settings';
export const BG_IMAGE_KEY = 'biliprism:bg-image';

function merge(raw: Partial<Settings> | undefined): Settings {
  const r = raw ?? {};
  return {
    ...DEFAULTS,
    ...r,
    player: { ...DEFAULTS.player, ...(r.player ?? {}) },
    filters: { ...DEFAULTS.filters, ...(r.filters ?? {}) },
    bg: { ...DEFAULTS.bg, ...(r.bg ?? {}) },
    palette: 'classic', // 旧版存过 mist，统一回到经典
  };
}

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(KEY);
  return sanitizeSettings(r[KEY]) ?? merge(undefined);
}

let saveQueue: Promise<unknown> = Promise.resolve();
export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const operation = saveQueue.then(async () => {
    const next = merge({ ...(await loadSettings()), ...patch });
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  });
  saveQueue = operation.catch(() => {});
  return operation;
}

export function onSettingsChange(cb: (s: Settings, prev: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    cb(sanitizeSettings(changes[KEY].newValue) ?? merge(undefined), sanitizeSettings(changes[KEY].oldValue) ?? merge(undefined));
  });
}

/**
 * 校验导入的设置：只取认识的字段、类型不对的丢掉，其余用默认值补齐。整体不是对象时返回 null。
 */
export function sanitizeSettings(raw: unknown): Settings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};
  const bool = (k: 'enabled' | 'hoverPreview' | 'watch' | 'intro' | 'footprint' | 'weather' | 'favDirect') => { if (typeof r[k] === 'boolean') out[k] = r[k] as boolean; };
  bool('enabled'); bool('hoverPreview'); bool('watch'); bool('intro'); bool('footprint'); bool('weather'); bool('favDirect');
  if (r.theme === 'auto' || r.theme === 'light' || r.theme === 'dark') out.theme = r.theme;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 200).slice(0, 500) : undefined);
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined);
  const f = (r.filters && typeof r.filters === 'object' ? r.filters : {}) as Record<string, unknown>;
  out.filters = { ...DEFAULTS.filters };
  out.filters.keywords = strs(f.keywords) ?? DEFAULTS.filters.keywords;
  out.filters.ups = strs(f.ups) ?? DEFAULTS.filters.ups;
  out.filters.minViews = num(f.minViews, 1e10) ?? DEFAULTS.filters.minViews;
  out.filters.minDuration = num(f.minDuration, 86400) ?? DEFAULTS.filters.minDuration;
  const b = (r.bg && typeof r.bg === 'object' ? r.bg : {}) as Record<string, unknown>;
  const SHADERS: ShaderId[] = ['aurora', 'silk', 'mesh', 'grain', 'ice', 'veil', 'smoke', 'neuro', 'flow', 'rays', 'blend', 'flux', 'gate'];
  out.bg = {
    mode: (['random', 'fixed', 'image', 'off'] as BgMode[]).includes(b.mode as BgMode) ? (b.mode as BgMode) : DEFAULTS.bg.mode,
    shader: SHADERS.includes(b.shader as ShaderId) ? (b.shader as ShaderId) : DEFAULTS.bg.shader,
    intensity: num(b.intensity, 1) ?? DEFAULTS.bg.intensity,
  };
  const p = (r.player && typeof r.player === 'object' ? r.player : {}) as Record<string, unknown>;
  out.player = { ...DEFAULTS.player };
  for (const k of ['wheelVolume', 'rememberSpeed', 'wide', 'subtitleExport'] as const) if (typeof p[k] === 'boolean') out.player[k] = p[k];
  if (typeof p.volumeStep === 'number' && Number.isFinite(p.volumeStep)) out.player.volumeStep = Math.round(Math.max(1, Math.min(50, p.volumeStep)));
  if (typeof p.speed === 'number' && Number.isFinite(p.speed)) out.player.speed = Math.max(0.25, Math.min(5, p.speed));
  return merge(out);
}

/** 整份替换设置（导入用） */
export async function replaceSettings(next: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: merge(next) });
}
