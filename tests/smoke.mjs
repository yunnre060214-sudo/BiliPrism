// 冒烟测试：加载构建好的扩展（dist/），在离线伪造的 B 站上依次打开各个接管页面，
// 断言扩展没有抛未捕获错误、关键元素都在，并保存亮 / 暗两套 1440 截图。
//   npm run build && node tests/smoke.mjs
// 环境变量：CHROMIUM_PATH 指定浏览器（默认用 Playwright 自带的 chromium），SMOKE_OUT 截图目录（默认 tests/artifacts），
// SMOKE_THEMES=light,dark，SMOKE_ONLY=home,watch 只跑部分页面。
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';

const EXT = resolve(process.env.SMOKE_EXT || 'dist');
const OUT = resolve(process.env.SMOKE_OUT || 'tests/artifacts');
const THEMES = (process.env.SMOKE_THEMES || 'light,dark').split(',');
const ONLY = process.env.SMOKE_ONLY ? process.env.SMOKE_ONLY.split(',') : null;
if (!existsSync(join(EXT, 'manifest.json'))) { console.error('dist/ 不存在，先 npm run build'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const R = "document.getElementById('margin-root')?.shadowRoot";
/** 每个页面：地址 + 在页面里求值、返回缺失项列表的检查 */
const PAGES = [
  ['home', 'https://www.bilibili.com/', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (r.querySelectorAll('.grid .card').length < 4) miss.push('.grid .card ×4');
    for (const s of ['header', '.fp-card .fp-cells', '.hero-search, .hs', '.dash']) if (!r.querySelector(s)) miss.push(s);
    return miss; })()`],
  ['watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', `(() => { const miss = [];
    if (!document.documentElement.classList.contains('margin-watch')) miss.push('html.margin-watch');
    if (!document.getElementById('margin-watch-css')) miss.push('#margin-watch-css');
    const t = document.getElementById('margin-watch-top')?.shadowRoot; if (!t || !t.querySelector('header')) miss.push('#margin-watch-top header');
    return miss; })()`],
  ['search', 'https://search.bilibili.com/all?keyword=%E6%98%A0%E9%97%B4', `(() => {
    const miss = []; if (!document.documentElement.classList.contains('margin-search')) miss.push('html.margin-search');
    if (!document.getElementById('margin-watch-top')) miss.push('#margin-watch-top'); return miss; })()`],
  ['space', 'https://space.bilibili.com/2/video', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (!r.querySelector('main.tk')) miss.push('main.tk'); if (!r.querySelector('header')) miss.push('header'); return miss; })()`],
  ['message', 'https://message.bilibili.com/', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (!r.querySelector('main.tk')) miss.push('main.tk'); return miss; })()`],
  ['history', 'https://www.bilibili.com/account/history', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (!r.querySelector('main.tk')) miss.push('main.tk');
    const rows = [...r.querySelectorAll('.hi-row:not(.sk)')].map((e) => e.getBoundingClientRect());
    if (rows.length < 3) miss.push('.hi-row ×3');
    // v0.31.1 回归：条目曾因和首页搜索的 .hs-row 同名被压成 54px 高、互相重叠
    for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - 1) { miss.push('.hi-row ' + i + ' overlaps previous'); break; }
    return miss; })()`],
  ['opus', 'https://www.bilibili.com/opus/1005142803949289489', `(() => { const miss = []; const de = document.documentElement;
    if (de.dataset.marginDetail !== 'opus') miss.push('html[data-margin-detail=opus]');
    const a = document.getElementById('margin-aside'); const r = a?.shadowRoot; if (!r) return [...miss, '#margin-aside'];
    if (a.hidden) miss.push('#margin-aside hidden at 1440');
    if (!r.querySelector('.author .who b')?.textContent?.trim()) miss.push('.author name');
    if (r.querySelectorAll('.toc a').length < 3) miss.push('.toc ×3');
    if (r.querySelectorAll('.acts .act:not([hidden])').length < 5) miss.push('.acts ×5');
    // 侧栏和正文不能重叠
    const m = document.querySelector('.opus-detail')?.getBoundingClientRect(), s = a.getBoundingClientRect();
    if (m && s.left < m.right + 40) miss.push('aside overlaps article');
    return miss; })()`],
  ['feed', 'https://t.bilibili.com/', `(() => { const r = ${R}; if (!r) return ['#margin-root'];
    const miss = []; if (!r.querySelector('main.tk')) miss.push('main.tk'); return miss; })()`],
].filter(([n]) => !ONLY || ONLY.includes(n));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0;
let footprintFont = null;

for (const theme of THEMES) {
  const dir = mkdtempSync(join(tmpdir(), 'margin-smoke-'));
  const exe = process.env.SMOKE_BUNDLED ? undefined : process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const ctx = await chromium.launchPersistentContext(dir, {
    ...(exe ? { executablePath: exe } : { channel: 'chromium' }),
    headless: true,
    args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    colorScheme: theme,
  });
  await installMocks(ctx);
  await ctx.addInitScript(() => { try { sessionStorage.setItem('biliprism:intro-played', '1'); } catch { /* */ } });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10_000 }).catch(() => null);

  if (sw) await sw.evaluate(async () => {
    const key = 'biliprism:settings', s = (await chrome.storage.local.get(key))[key] || {};
    await chrome.storage.local.set({ [key]: { ...s, weather: true } });
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Runtime.enable');
  let errors = [];
  const fromExt = (s) => /chrome-extension:\/\/|\[BiliPrism\]/.test(s);
  cdp.on('Runtime.exceptionThrown', (e) => {
    const d = e.exceptionDetails; const text = `${d.exception?.description || d.text} @ ${d.url || ''}`;
    if (fromExt(text) || fromExt(JSON.stringify(d.stackTrace || ''))) errors.push(text.slice(0, 400));
  });
  page.on('console', (m) => { if (m.type() === 'error' && fromExt(m.text() + (m.location()?.url || ''))) errors.push(m.text().slice(0, 400)); });

  for (const [name, url, check] of PAGES) {
    errors = [];
    const t0 = Date.now();
    let miss = ['(未执行)'];
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      for (let i = 0; i < 40; i++) {
        miss = await page.evaluate(check).catch((e) => [`evaluate: ${e.message}`]);
        if (!miss.length) break;
        await sleep(250);
      }
      await sleep(2500);
      if (name === 'home' && !miss.length) {
        for (const width of [1024, 2048, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await sleep(250);
          const ui = await page.evaluate(() => {
            const r = document.getElementById('margin-root').shadowRoot;
            const appFont = getComputedStyle(r.querySelector('.app')).fontFamily;
            const head = getComputedStyle(r.querySelector('.fp-head'));
            const graph = r.querySelector('.fp-graph'), cell = r.querySelector('.fp-cells .fp-cell').getBoundingClientRect();
            return { font: [head.fontFamily, head.fontSize, head.fontWeight, head.lineHeight].join('|'),
              removed: !!r.querySelector('.fp-foot, .fp-legend, .bar .no, .fp-top .eyebrow > span:nth-child(2)'),
              square: Math.abs(cell.width - cell.height) < .15,
              fits: graph.scrollWidth <= graph.clientWidth + 2,
              dates: getComputedStyle(r.querySelector('.bar > .eyebrow')).fontFamily === appFont,
              clock: getComputedStyle(r.querySelector('.wx-live')).fontFamily === appFont,
              monthWrap: [...r.querySelectorAll('.fp-months span')].some(n => n.getBoundingClientRect().height > 16) };
          });
          if (ui.removed || !ui.square || !ui.fits || !ui.dates || !ui.clock || ui.monthWrap) miss.push('home typography/layout ' + width + ': ' + JSON.stringify(ui));
          if (footprintFont && footprintFont !== ui.font) miss.push('footprint font differs between themes');
          footprintFont = ui.font;
        }
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `${name}-${theme}.png`), Buffer.from(shot.data, 'base64'));
    } catch (e) { miss = [`goto: ${e.message}`]; }
    const ok = !miss.length && !errors.length;
    if (!ok) failed++;
    results.push({ theme, name, ok, ms: Date.now() - t0, miss, errors });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} ${name.padEnd(8)} ${Date.now() - t0}ms${miss.length ? ` missing: ${miss.join(', ')}` : ''}${errors.length ? `\n      errors: ${errors.join('\n              ')}` : ''}`);
  }

  // 模块挂载失败时回到原版：用调试钩子 margin:test-throw 让模块故意抛错
  if (theme === THEMES[0] && !ONLY) for (const [name, url, key] of [
    ['fallback-home', 'https://www.bilibili.com/', 'home'],
    ['fallback-watch', 'https://www.bilibili.com/video/BV1mdxN68E7F/', 'watch'],
    ['fallback-space', 'https://space.bilibili.com/2/video', 'space'],
  ]) {
    errors = [];
    let miss = [];
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.evaluate((k) => localStorage.setItem('biliprism:test-throw', k), key);
      await page.goto(url, { waitUntil: 'load' });
      await sleep(2500);
      miss = await page.evaluate(() => {
        const m = [];
        for (const id of ['margin-root', 'margin-watch-top', 'margin-hide', 'margin-watch-css']) if (document.getElementById(id)) m.push(`#${id} still present`);
        if (document.documentElement.classList.contains('margin-skin')) m.push('html.margin-skin still present');
        if (!document.body || getComputedStyle(document.body).display === 'none') m.push('native body hidden');
        localStorage.removeItem('biliprism:test-throw');
        return m;
      });
    } catch (e) { miss = [`goto: ${e.message}`]; }
    const expected = errors.filter((e) => e.includes('test-throw'));
    const unexpected = errors.filter((e) => !e.includes('test-throw'));
    if (!expected.length) miss.push('no [BiliPrism] mount-failure log');
    const ok = !miss.length && !unexpected.length;
    if (!ok) failed++;
    results.push({ theme, name, ok, miss, errors: unexpected });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} ${name.padEnd(15)}${miss.length ? ` problems: ${miss.join(', ')}` : ' native page restored'}${unexpected.length ? `\n      errors: ${unexpected.join('\n              ')}` : ''}`);
  }

  // 足迹热力图：不到 60 秒的日子不点亮；没有本机记录的日子用历史估算，提示里标明来源
  if (sw && theme === THEMES[0] && (!ONLY || ONLY.includes('home'))) {
    let miss = [];
    try {
      await sw.evaluate(async () => {
        const p = (n) => String(n).padStart(2, '0'), k = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        const a = {}, ago = (i) => { const d = new Date(); d.setDate(d.getDate() - i); return k(d); };
        a[ago(2)] = { s: 1800, f: '08:30' }; a[ago(3)] = { s: 30, f: '09:00' }; a[ago(4)] = { s: 0, h: 1200, hf: '21:00' };
        await chrome.storage.local.set({ 'biliprism:activity': a, 'biliprism:activity-bf': Date.now() });
      });
      await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('margin-root')?.shadowRoot?.querySelector('.fp-cells .fp-cell'), null, { timeout: 15000 });
      await sleep(800);
      miss = await page.evaluate(() => {
        const r = document.getElementById('margin-root').shadowRoot, m = [];
        const p = (n) => String(n).padStart(2, '0'), ago = (i) => { const d = new Date(); d.setDate(d.getDate() - i); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
        const cell = (i) => r.querySelector(`.fp-cell[data-k="${ago(i)}"]`);
        if (cell(3)?.dataset.l !== '0') m.push('30s day should not light');
        if (cell(2)?.dataset.l === '0') m.push('30min local day should light');
        if (cell(4)?.dataset.l === '0') m.push('history-only day should light');
        const tip = (i) => { cell(i).dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return r.querySelector('.fp-tip').textContent; };
        if (!tip(2).includes('本机记录')) m.push('tooltip local source');
        if (!tip(4).includes('历史估算')) m.push('tooltip history source');
        return m;
      });
    } catch (e) { miss = [`footprint-ui: ${e.message}`]; }
    const ok = !miss.length;
    if (!ok) failed++;
    results.push({ theme, name: 'footprint-ui', ok, miss });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} footprint-ui${miss.length ? ` problems: ${miss.join(', ')}` : ' 60s threshold + source tooltip'}`);
  }

  // 足迹计时在后台 service worker：打开过页面后今天应该有首次打开时间
  if (sw) {
    const today = await sw.evaluate(async () => {
      const d = new Date(), p = (n) => String(n).padStart(2, '0');
      const k = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      return (await chrome.storage.local.get('biliprism:activity'))['biliprism:activity']?.[k] ?? null;
    }).catch((e) => ({ error: e.message }));
    const ok = !!today?.f;
    if (!ok) failed++;
    results.push({ theme, name: 'footprint-sw', ok, today });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${theme.padEnd(5)} footprint service worker recorded first open: ${JSON.stringify(today)}`);
  } else {
    failed++;
    results.push({ theme, name: 'service-worker', ok: false });
    console.log(`FAIL ${theme} background service worker not running`);
  }
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
}

writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(failed ? `\n${failed} check(s) failed` : '\nall smoke checks passed');
process.exit(failed ? 1 : 0);
