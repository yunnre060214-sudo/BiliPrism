import { DEFAULTS, saveSettings, type Settings } from '../../shared/settings';
import { h } from './dom';
import { block, chipInput, row, toggle } from './controls';

/** BewlyCat-style independently configurable components, layout and filters. */
export function customSettings(get: () => Settings): { sections: HTMLElement[]; sync(s: Settings): void } {
  const syncers: ((s: Settings) => void)[] = [];
  type Group = 'appearance' | 'comments' | 'moments';
  const save = <G extends Group>(group: G, key: keyof Settings[G], value: unknown) =>
    saveSettings({ [group]: { ...get()[group], [key]: value } });
  const choice = <G extends Group>(group: G, key: keyof Settings[G], label: string, values: [string, string][], numeric = true) => {
    const select = h('select', { 'aria-label': label, style: 'font:inherit;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px;max-width:180px' },
      ...values.map(([value, text]) => h('option', { value }, text)));
    select.value = String(get()[group][key]);
    select.onchange = () => save(group, key, numeric ? Number(select.value) : select.value);
    syncers.push(s => { select.value = String(s[group][key]); });
    return row(label, null, select);
  };
  const flag = <G extends Group>(group: G, key: keyof Settings[G], label: string, hint: string | null = null) => {
    const control = toggle(Boolean(get()[group][key]), label, v => save(group, key, v));
    syncers.push(s => control.setAttribute('aria-checked', String(s[group][key])));
    return row(label, hint, control);
  };
  const chips = (key: 'keywords' | 'blockedUsers' | 'wantedUsers' | 'pinnedUsers', label: string, hint: string) => {
    const control = chipInput(get().moments[key], `${label}，回车添加`, v => save('moments', key, v));
    syncers.push(s => control.set(s.moments[key]));
    return block(label, hint, control);
  };
  const color = h('input', { type: 'color', value: get().appearance.accent, 'aria-label': '主题强调色' });
  color.onchange = () => save('appearance', 'accent', color.value);
  syncers.push(s => { color.value = s.appearance.accent; });
  const appearance = h('section', { class: 'group' }, h('h3', {}, '文字与界面'),
    choice('appearance', 'fontSize', '正文字号', [14,15,16,18,20].map(n => [String(n), `${n} px`])),
    choice('appearance', 'fontWeight', '正文字重', [['400','常规 400'],['500','适中 500'],['600','加粗 600']]),
    choice('appearance', 'lineHeight', '正文行高', [['1.5','紧凑 1.5'],['1.7','舒适 1.7'],['2','宽松 2.0']]),
    row('主题强调色', null, color),
    choice('appearance', 'radius', '卡片圆角', [0,8,12,16,20,24].map(n => [String(n), `${n} px`])),
    flag('appearance', 'solidSurfaces', '使用实色面板', '取消顶栏和面板的半透明模糊，提升文字边缘清晰度'),
    flag('appearance', 'reduceMotion', '减少界面动效'),
    h('button', { type: 'button', class: 'ghost small', onclick: () => saveSettings({ appearance: { ...DEFAULTS.appearance } }) }, '恢复文字与界面默认值'));
  const comments = h('section', { class: 'group' }, h('h3', {}, '评论树自定义'),
    choice('comments', 'indent', '每级缩进', [16,24,32,40,48].map(n => [String(n), `${n} px`])),
    choice('comments', 'lineWidth', '连线粗细', [1,2,3].map(n => [String(n), `${n} px`])),
    flag('comments', 'showGuides', '显示楼层连线', '关闭连线时仍保留缩进与全部展开按钮'),
    choice('comments', 'batchPages', '每次展开页数', [1,3,5,10].map(n => [String(n), `${n} 页`])),
    h('p', { style: 'color:var(--muted);font-size:14px' }, '楼层底部可全部展开、继续加载或收起。通过原生组件顺序加载，多页回复保留为一棵树。'));
  const moments = h('section', { class: 'group' }, h('h3', {}, 'BewlyCat 动态页'),
    choice('moments', 'columns', '动态卡片列数', [['1','单列'],['2','双列']]),
    flag('moments', 'compact', '紧凑卡片'),
    flag('moments', 'tabsCentered', '筛选标签居中'),
    flag('moments', 'showProfile', '显示个人资料卡'),
    flag('moments', 'showLive', '显示正在直播'),
    flag('moments', 'showHot', '显示热搜侧栏'),
    flag('moments', 'showUpList', '显示 UP 主列表'),
    flag('moments', 'autoLoad', '滚动自动加载', '关闭后使用底部「加载更多」'),
    flag('moments', 'openInNewTab', '动态链接在新标签打开'),
    flag('moments', 'hideReposts', '过滤转发动态'),
    flag('moments', 'hideVideo', '过滤视频动态'),
    flag('moments', 'hideArticle', '过滤专栏动态'),
    flag('moments', 'hidePictures', '过滤图片动态'),
    chips('keywords', '动态屏蔽关键词', '匹配正文、标题、转发原文；不区分大小写'),
    chips('blockedUsers', '动态屏蔽 UP 主', '昵称或 MID，支持同时屏蔽转发原作者'),
    chips('wantedUsers', '特别关注 UP 主', '昵称或 MID；动态页点「特别关注」仅看这些人'),
    chips('pinnedUsers', '置顶 UP 主', '昵称或 MID；在顶部头像列表优先显示'));
  return { sections: [appearance, comments, moments], sync: s => syncers.forEach(run => run(s)) };
}
