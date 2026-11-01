import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'vite';
const bundle = await build({ configFile: false, publicDir: false, logLevel: 'silent', build: { write: false, minify: false, target: 'es2022', lib: { entry: 'tests/logic-entry.ts', formats: ['es'] } } });
const code = bundle[0].output.find(x => x.type === 'chunk').code;
const m = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
test('播放器数值对异常类型、无穷值与边界做规范化', () => {
  assert.equal(m.normalizeWheelVolumeStep(NaN), 5);
  assert.equal(m.normalizeWheelVolumeStep(-30), 1);
  assert.equal(m.normalizeWheelVolumeStep(99), 50);
  assert.equal(m.normalizePlaybackRate(Infinity), 1);
  assert.equal(m.normalizePlaybackRate(.1), .25);
  assert.equal(m.normalizePlaybackRate(9), 5);
});
test('损坏的设置导入不会污染类型，旧版本补齐播放器字段', () => {
  assert.equal(m.sanitizeSettings([]), null);
  const s = m.sanitizeSettings({ enabled: 'false', weather: false, filters: { keywords: ['a', 4], minViews: -1 }, player: { speed: 20, volumeStep: 0, wide: true, wheelVolume: 'yes' } });
  assert.equal(s.enabled, true); assert.equal(s.weather, false);
  assert.deepEqual(s.filters.keywords, ['a']); assert.equal(s.filters.minViews, 0);
  assert.equal(s.player.speed, 5); assert.equal(s.player.volumeStep, 1);
  assert.equal(s.player.wide, true); assert.equal(s.player.wheelVolume, true);
  assert.equal(m.sanitizeSettings({ theme: 'dark' }).player.rememberSpeed, true);
});
test('字幕时间毫秒进位与小时不会溢出', () => {
  assert.equal(m.subtitleTime(59.9996), '00:01:00,000');
  assert.equal(m.subtitleTime(3600.125), '01:00:00,125');
  assert.equal(m.subtitleTime(-1), '00:00:00,000');
});
test('字幕转换保留文本内容，过滤非法时间轴', () => {
  const cues = m.sanitizeCues({ body: [{ from: 0, to: 1.125, content: '<b>你好</b>' }, { from: -1, to: 2, content: 'bad' }, { from: 5, to: 4, content: 'bad' }] });
  assert.equal(cues.length, 1);
  assert.equal(m.formatSubtitles(cues, 'srt'), '1\n00:00:00,000 --> 00:00:01,125\n<b>你好</b>\n');
  assert.equal(m.formatSubtitles(cues, 'txt'), '<b>你好</b>\n');
  assert.deepEqual(JSON.parse(m.formatSubtitles(cues, 'json')), { body: cues });
  assert.throws(() => m.sanitizeCues({}), /字幕格式/);
});
test('字幕域名校验拒绝伪后缀、明文 HTTP 与带凭据链接', () => {
  assert.match(m.trustedSubtitleUrl('//aisubtitle.hdslb.com/a.json'), /^https:/);
  for (const u of ['https://hdslb.com.attacker.test/a', 'http://i0.hdslb.com/a', 'https://x:password@i0.hdslb.com/a', 'data:application/json,{}'])
    assert.throws(() => m.trustedSubtitleUrl(u), /域名/);
});
test('带 g 的过滤正则在连续卡片上结果一致', () => {
  const filter = m.compileFilter({ keywords: ['/apple/g'], ups: [], minViews: 0, minDuration: 0 });
  const v = { title: 'Apple 视频', mid: 1, author: 'up', views: 10, duration: 20 };
  assert.equal(filter(v), false); assert.equal(filter(v), false);
  assert.equal(filter({ ...v, title: '普通视频' }), true);
});
test('设置存储读取经过校验，连续写入保留不同字段', async () => {
  const db = { 'biliprism:settings': { enabled: 'bad', player: { speed: 'bad' } } };
  globalThis.chrome = { storage: { local: { async get(k) { return { [k]: db[k] }; }, async set(v) { Object.assign(db, v); } } } };
  assert.equal((await m.loadSettings()).player.speed, 1);
  await Promise.all([m.saveSettings({ theme: 'dark' }), m.saveSettings({ weather: true })]);
  assert.equal(db['biliprism:settings'].theme, 'dark'); assert.equal(db['biliprism:settings'].weather, true);
});
test('字幕列表使用当前分 P 的 CID，空字幕有明确错误', async () => {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const u = new URL(url);
    let data = {};
    if (u.pathname.endsWith('/view')) data = { bvid: 'BVtest123', title: '测试', cid: 11, pages: [{ cid: 11 }, { cid: 22 }] };
    else if (u.pathname.endsWith('/nav')) data = { wbi_img: { img_url: 'https://i0.hdslb.com/12345678901234567890123456789012.png', sub_url: 'https://i0.hdslb.com/12345678901234567890123456789012.png' } };
    else data = { subtitle: { subtitles: [{ id: 1, lan: 'zh-CN', lan_doc: '中文', subtitle_url: '//i0.hdslb.com/a.json' }] } };
    return { ok: true, async json() { return { code: 0, data }; } };
  };
  const info = await m.listSubtitles('https://www.bilibili.com/video/BVtest123?p=2');
  assert.equal(info.cid, 22); assert.ok(calls.some(u => u.includes('cid=22')));
  await assert.rejects(m.listSubtitles('https://www.bilibili.com/video/BVtest123?p=9'), /分 P/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('/x/player/') ? { ok: true, async json() { return { code: 0, data: { subtitle: { subtitles: [] } } }; } } : originalFetch(url);
  await assert.rejects(m.listSubtitles('https://www.bilibili.com/video/BVtest123'), /暂无可导出字幕/);
});
