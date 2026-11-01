import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { nativeRender } from './fixtures/native-render.mjs';
import { installMocks } from './mocks.mjs';

const require = createRequire(import.meta.url);
const Vue = require('vue');
const { createRenderer } = require('vue-server-renderer');
const ssr = await createRenderer().renderToString(new Vue({ data: () => ({ hydrated: false }), render: nativeRender }));
const runtime = readFileSync('node_modules/vue/dist/vue.runtime.js', 'utf8');
const video = readFileSync('tests/fixtures/playback.webm');
const EXT = resolve('dist'), dir = mkdtempSync(join(tmpdir(), 'biliprism-hydration-'));
const ctx = await chromium.launchPersistentContext(dir, {
  channel: 'chromium', headless: true,
  args: ['--no-sandbox', '--headless=new', '--autoplay-policy=no-user-gesture-required', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 1000 },
});
const results = [];
mkdirSync('tests/artifacts', { recursive: true });
try {
  await installMocks(ctx);
  await ctx.route('**/video/BVhydrate123/**', route => route.request().isNavigationRequest()
    ? route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body>' + ssr + '</body></html>' })
    : route.fallback());
  await ctx.route('**/test-playback.webm', route => route.fulfill({ contentType: 'video/webm', body: video }));
  await ctx.route('**/test-cover.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="45"><rect width="80" height="45" fill="#4c9"/></svg>' }));

  for (const legacy of [true, false]) {
    const page = await ctx.newPage(), errors = [], warnings = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'warn' || e.type() === 'error') warnings.push(e.text()); });
    await page.goto('https://www.bilibili.com/video/BVhydrate123/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.getElementById('biliprism-player-css'));
    assert.equal(await page.locator('#biliprism-player-tools').count(), 0);
    await page.evaluate(legacy => {
      window.beforeHydration = { app: document.getElementById('app'), video: document.getElementById('native-video') };
      if (legacy) {
        // 负向对照：复现 v0.1.2 的 anchor.after(panel)，打乱 SSR 原生兄弟节点序列。
        const foreign = document.createElement('div'); foreign.id = 'legacy-tools';
        document.getElementById('playerWrap').after(foreign);
      }
    }, legacy);
    await page.addScriptTag({ content: runtime });
    await page.addScriptTag({ content: `new Vue({ el: '#app', data: function(){ return { hydrated: false }; }, render: ${nativeRender.toString()}, mounted: function(){ this.hydrated = true; } });` });
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({
      sameApp: window.beforeHydration.app === document.getElementById('app'),
      sameVideo: window.beforeHydration.video === document.getElementById('native-video'),
      initialized: document.getElementById('native-toolbar')?.textContent === '原生初始化完成',
    }));
    if (legacy) {
      assert.ok(!state.sameVideo || !state.initialized || errors.length || warnings.some(w => /hydration|not matching|server-rendered/i.test(w)), '旧插入位置必须使原生初始化或 DOM 复用检查失败');
      results.push({ name: '旧插入方式负向对照', detected: true, state, errors, warnings });
      console.log('PASS 负向对照：旧插入方式破坏 SSR 初始化，已被检查捕获');
    } else {
      assert.deepEqual(state, { sameApp: true, sameVideo: true, initialized: true });
      assert.deepEqual(errors, []);
      assert.equal(warnings.some(w => /hydration|not matching|server-rendered/i.test(w)), false);
      await page.locator('#native-video').evaluate(v => { v.muted = true; return v.play(); });
      await page.waitForFunction(() => {
        const v = document.getElementById('native-video');
        return !v.paused && v.readyState >= 3 && v.currentTime > .5 && v.videoWidth === 320 && v.getVideoPlaybackQuality().totalVideoFrames > 2;
      });
      const playback = await page.locator('#native-video').evaluate(v => ({ time: v.currentTime, width: v.videoWidth, frames: v.getVideoPlaybackQuality().totalVideoFrames }));
      results.push({ name: '独立宿主的原生初始化与解码播放', state, playback });
      await page.screenshot({ path: 'tests/artifacts/hydration-playback.png' });
      console.log('PASS 新挂载方式：SSR 节点复用、原生更新与 WebM 解码播放正常 ' + JSON.stringify(playback));
    }
    await page.close();
  }
  mkdirSync('tests/artifacts', { recursive: true });
  writeFileSync('tests/artifacts/hydration-results.json', JSON.stringify(results, null, 2));
} finally { await ctx.close(); rmSync(dir, { recursive: true, force: true }); }
