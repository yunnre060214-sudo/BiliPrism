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

test('评论树按父子与时间排序，跨页回溯已知祖先，循环关系不丢节点', () => {
  const item = (id, parent, time) => ({ item: id, meta: { id, parent, root: '10', time } });
  const nodes = [item('12','11',3), item('14','12',5), item('11','10',1), item('13','10',2)];
  assert.deepEqual(m.orderReplies(nodes).map(n => [n.item,n.depth]), [['11',0],['12',1],['14',2],['13',0]]);
  const cache = new Map(nodes.map(n => [n.meta.id,n.meta]));
  assert.deepEqual(m.orderReplies([nodes[1],nodes[2]],cache).map(n => [n.item,n.depth]), [['11',0],['14',1]]);
  assert.equal(m.orderReplies([item('1','2',1),item('2','1',2)]).length,2);
  assert.equal(m.orderReplies([item('1','1',1)]).length,1);
});
test('BewlyCat 连线几何生成圆弧且不越过头像', () => {
  const parent = { centerX:12,centerY:12,bottom:24,left:0,toggleY:30 };
  const child = { centerX:44,centerY:70,bottom:82,left:32,toggleY:90 };
  const path = m.getCommentReplyBranchPath({ key:'a',parentAnchor:parent,childAnchors:[child],collapsed:false,collapseParentBody:false,parentAuthorName:'A' },12,8);
  assert.match(path,/A 12 12/);assert.match(path,/H 32/);
});

test('旧设置补齐外观和动态配置；非法 CSS 与异常数值不可注入', () => {
  const old=m.sanitizeSettings({theme:'dark'});
  assert.equal(old.appearance.fontSize,15);assert.equal(old.moments.columns,2);assert.equal(old.comments.batchPages,5);
  const s=m.sanitizeSettings({appearance:{fontSize:2,fontWeight:100,lineHeight:9,accent:'red;display:none',radius:Infinity},comments:{indent:400,batchPages:-1,lineWidth:0},moments:{columns:12,keywords:['xx',null],showHot:false}});
  assert.deepEqual([s.appearance.fontSize,s.appearance.fontWeight,s.appearance.lineHeight,s.appearance.accent],[14,500,2,'#00aeec']);
  assert.deepEqual([s.comments.indent,s.comments.batchPages,s.comments.lineWidth],[48,1,1]);
  assert.equal(s.moments.columns,2);assert.equal(s.moments.showHot,false);assert.deepEqual(s.moments.keywords,['xx']);
});
test('动态过滤覆盖转发原文、UP 主、特别关注及类型；置顶优先于更新', () => {
  const d={id:'1',type:'DYNAMIC_TYPE_AV',mid:8,author:'作者',text:'Hello',pics:[],video:{title:'Video'},stat:{}};
  const s=m.DEFAULTS.moments;
  assert.equal(m.allowMoment(d,s),true);
  assert.equal(m.allowMoment(d,{...s,hideVideo:true}),false);
  assert.equal(m.allowMoment({...d,orig:{...d,mid:9,author:'原作者',text:'AD'}},{...s,keywords:['ad']}),false);
  assert.equal(m.allowMoment({...d,orig:{...d,mid:9,author:'原作者'}},{...s,blockedUsers:['9']}),false);
  assert.equal(m.allowMoment(d,{...s,wantedUsers:['作者']},true),true);
  assert.equal(m.allowMoment(d,s,true),false);
  assert.deepEqual(m.sortUps([{mid:1,name:'A',fresh:true},{mid:2,name:'B',fresh:false}],['2']).map(u=>u.mid),[2,1]);
});
test('批量展开多页按 rpid 字符串去重，后取得的原生数据优先', () => {
  const a={rpid_str:'123456789012345678',like:1},b={rpid_str:'123456789012345679',like:2};
  assert.deepEqual(m.mergeReplies([[a,b],[{...a,like:3}]]).map(d=>d.like),[3,2]);
});
test('动态映射保留番剧附件和富文本，拒绝非网页跳转', () => {
  const d=m.toDyn({id_str:'12',type:'DYNAMIC_TYPE_PGC',modules:{module_dynamic:{desc:{text:'番剧推荐 @作者',rich_text_nodes:[{text:'番剧推荐',jump_url:'javascript:alert(1)'},{type:'RICH_TEXT_NODE_TYPE_AT',text:'@作者',rid:8}]},major:{pgc:{title:'番剧',cover:'//i0.hdslb.com/test.jpg',jump_url:'//www.bilibili.com/bangumi/play/ep12'}}}}});
  assert.equal(d.attachment.kind,'PGC');assert.match(d.attachment.url,/^https:\/\//);assert.equal(d.segments[0].url,'');assert.equal(d.segments[1].url,'https://space.bilibili.com/8');
});
