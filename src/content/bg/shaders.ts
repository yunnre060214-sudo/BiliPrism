import type { ShaderId } from '../../shared/settings';
// 沿用主题 ID 便于设置兼容，全部为静态渐变。
export const SHADER_IDS: ShaderId[] = ['veil', 'smoke', 'neuro', 'flow', 'rays', 'blend', 'aurora', 'silk', 'mesh', 'grain', 'ice', 'flux', 'gate'];
export const SHADER_NAMES: Record<ShaderId, string> = { gate: '青棱', aurora: '极光', silk: '丝绸', mesh: '网格', grain: '暖沙', ice: '冰蓝', veil: '丝缎', smoke: '烟霞', neuro: '草木', flow: '流沙', rays: '天光', blend: '弥散', flux: '紫棱' };
