import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const EXT = resolve('dist'), dir = mkdtempSync(join(tmpdir(), 'biliprism-features-'));
const ctx = await chromium.launchPersistentContext(dir, {
  channel: 'chromium', headless: true, acceptDownloads: true,
  args: ['--no-sandbox', '--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 1000 },
});
const results = [];
const check = async (name, fn) => { await fn(); results.push({ name, ok: true }); console.log('PASS ' + name); };
try {
  await installMocks(ctx);
  await ctx.route('**/x/web-interface/view?**', route => route.fulfill({ json: { code: 0, data: { bvid: 'BV1mdxN68E7F', title: '字幕测试', cid: 11, pages: [{ cid: 11 }, { cid: 22 }] } }, headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' } }));
  const cids = [];
  await ctx.route('**/x/player/wbi/v2?**', route => {
    cids.push(new URL(route.request().url()).searchParams.get('cid'));
    return route.fulfill({ json: { code: 0, data: { subtitle: { subtitles: [
      { id: 1, lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://aisubtitle.hdslb.com/test.json' },
      { id: 2, lan: 'en', lan_doc: 'English', subtitle_url: 'https://aisubtitle.hdslb.com/en.json' },
    ] } } }, headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' } });
  });
  await ctx.route('https://aisubtitle.hdslb.com/*.json', route => route.fulfill({ json: { body: [{ from: 0, to: 1.125, content: route.request().url().includes('en.json') ? 'Hello' : '你好，映棱' }] }, headers: { 'access-control-allow-origin': '*' } }));
  let sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const updatePlayer = patch => sw.evaluate(async patch => {
    const key = 'biliprism:settings', raw = (await chrome.storage.local.get(key))[key] || {};
    await chrome.storage.local.set({ [key]: { ...raw, player: { ...raw.player, ...patch } } });
  }, patch);
  const media = () => page.locator('#bilibili-player video');
  const tools = () => page.locator('#biliprism-player-tools');
  const open = async (suffix = '') => {
    await page.goto('https://www.bilibili.com/video/BV1mdxN68E7F/' + suffix);
    await page.evaluate(() => {
      const v = document.createElement('video'); v.volume = .5;
      document.getElementById('bilibili-player').append(v);
    });
    await tools().waitFor();
  };
  await open();
  await check('扩展真实加载、工具条唯一、没有光学位移滤镜和 GPU 背景', async () => {
    assert.equal(await tools().count(), 1);
    assert.equal(await media().evaluate(el => {
      for (let n = el.parentElement; n; n = n.parentElement) if (getComputedStyle(n).display === 'none') return false;
      return document.getElementById('bilibili-player').getBoundingClientRect().height > 200;
    }), true, '播放器祖先包含 ad-report 时仍应可见且保留高度');
    assert.equal(await page.locator('feDisplacementMap').count(), 0);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('*')].flatMap(n => n.shadowRoot ? [...n.shadowRoot.querySelectorAll('.bg canvas, feDisplacementMap')] : []).length), 0);
  });
  await check('非全屏滚轮保持原生行为', async () => {
    const prevented = await media().evaluate(el => !el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })));
    assert.equal(prevented, false); assert.equal(await media().evaluate(el => el.volume), .5);
  });
  await check('播放速度持久化并在新页面生效', async () => {
    await tools().getByLabel('播放速度').selectOption('1.5');
    await page.waitForFunction(() => document.querySelector('video').playbackRate === 1.5);
    for (let i = 0; i < 30; i++) {
      if (await sw.evaluate(async () => (await chrome.storage.local.get('biliprism:settings'))['biliprism:settings']?.player.speed === 1.5)) break;
      await page.waitForTimeout(100);
    }
    assert.equal(await sw.evaluate(async () => (await chrome.storage.local.get('biliprism:settings'))['biliprism:settings']?.player.speed), 1.5);
    await open('?p=2');
    await page.waitForFunction(() => document.querySelector('video').playbackRate === 1.5);
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      const next = document.createElement('video'); next.volume = .5;
      document.querySelector('video').replaceWith(next);
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page.waitForFunction(() => document.querySelector('video').playbackRate === 1.5);
  });
  await check('宽屏实时开关与持久化', async () => {
    await tools().getByRole('button', { name: '宽屏', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('biliprism-wide'));
    await tools().getByRole('button', { name: '宽屏', exact: true }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('biliprism-wide'));
  });
  await check('分 P 字幕导出 SRT、语言选择和 JSON', async () => {
    const dl = page.waitForEvent('download');
    await tools().getByRole('button', { name: '导出字幕', exact: true }).click();
    const file = await dl;
    const body = readFileSync(await file.path(), 'utf8');
    assert.match(body, /00:00:00,000 --> 00:00:01,125/); assert.match(body, /你好，映棱/);
    assert.equal(cids.at(-1), '22');
    await tools().getByLabel('字幕语言').selectOption('1');
    await tools().getByLabel('字幕格式').selectOption('json');
    const dl2 = page.waitForEvent('download');
    await tools().getByRole('button', { name: '导出字幕', exact: true }).click();
    const file2 = await dl2;
    assert.equal(JSON.parse(readFileSync(await file2.path(), 'utf8').replace(/^\uFEFF/, '')).body[0].content, 'Hello');
  });
  await check('全屏滚轮调音与菜单滚动排除', async () => {
    await page.evaluate(async () => {
      const changed = new Promise(resolve => document.addEventListener('fullscreenchange', resolve, { once: true }));
      await document.getElementById('bilibili-player').requestFullscreen();
      await changed;
    });
    await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
    await media().dispatchEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true });
    assert.equal(Math.round(await media().evaluate(el => el.volume) * 100), 55, '全屏滚轮应该把音量从 50% 增加到 55%');
    const scrolled = await page.evaluate(() => {
      const menu = document.createElement('div'); menu.style.cssText = 'height:50px;overflow-y:auto'; menu.innerHTML = '<div style="height:500px">list</div>';
      document.fullscreenElement.append(menu);
      return !menu.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    });
    assert.equal(scrolled, false); assert.ok(Math.abs(await media().evaluate(el => el.volume) - .55) < .001);
    await updatePlayer({ wheelVolume: false });
    await page.waitForTimeout(250);
    const blocked = await media().evaluate(el => !el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true })));
    assert.equal(blocked, false);
    await page.evaluate(() => document.exitFullscreen());
  });
  await check('关闭速度记忆、字幕模块及扩展总开关', async () => {
    await updatePlayer({ rememberSpeed: false, subtitleExport: false });
    await tools().getByRole('button', { name: '导出字幕', exact: true }).waitFor({ state: 'hidden' });
    await tools().getByLabel('播放速度').selectOption('2');
    await page.waitForTimeout(300);
    const saved = await sw.evaluate(async () => (await chrome.storage.local.get('biliprism:settings'))['biliprism:settings']);
    assert.equal(saved.player.speed, 1.5);
    await sw.evaluate(async () => {
      const key = 'biliprism:settings', raw = (await chrome.storage.local.get(key))[key];
      await chrome.storage.local.set({ [key]: { ...raw, enabled: false } });
    });
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#biliprism-player-tools').count(), 0);
  });
  assert.deepEqual(errors, []);
  mkdirSync('tests/artifacts', { recursive: true });
  writeFileSync('tests/artifacts/enhancements-results.json', JSON.stringify(results, null, 2));
  console.log('all enhancement checks passed');
} finally {
  await ctx.close(); rmSync(dir, { recursive: true, force: true });
}
