// 量各页面从导航开始到映棱挂上（#margin-root / #margin-watch-css 出现）的时间，离线伪造 B 站。
//   node tests/mount-timing.mjs [distDir] [runs]
import { chromium } from 'playwright';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { installMocks } from './mocks.mjs';
const EXT = resolve(process.argv[2] || 'dist');
const RUNS = Number(process.argv[3] || 5);
const URLS = { home: 'https://www.bilibili.com/', watch: 'https://www.bilibili.com/video/BV1mdxN68E7F/', history: 'https://www.bilibili.com/account/history' };
const dir = mkdtempSync(join(tmpdir(), 'margin-mt-'));
const exe = process.env.SMOKE_BUNDLED ? undefined : process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const ctx = await chromium.launchPersistentContext(dir, { ...(exe ? { executablePath: exe } : { channel: 'chromium' }), headless: true,
  args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`], viewport: { width: 1440, height: 900 } });
await installMocks(ctx);
await ctx.addInitScript(() => {
  try { sessionStorage.setItem('biliprism:intro-played', '1'); } catch { /* */ }
  const mo = new MutationObserver(() => {
    if (document.getElementById('margin-root') || document.getElementById('margin-watch-css')) { window.__mount = performance.now(); mo.disconnect(); }
  });
  mo.observe(document, { childList: true, subtree: true });
});
const page = ctx.pages()[0];
for (const [name, url] of Object.entries(URLS)) {
  const xs = [];
  for (let i = 0; i < RUNS + 1; i++) {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mount, null, { timeout: 15000 });
    if (i) xs.push(await page.evaluate(() => window.__mount)); // 第一次是冷启动，丢掉
  }
  xs.sort((a, b) => a - b);
  console.log(`${name.padEnd(8)} mount median ${xs[xs.length >> 1].toFixed(1)}ms  (min ${xs[0].toFixed(1)}, max ${xs.at(-1).toFixed(1)})`);
}
await ctx.close(); rmSync(dir, { recursive: true, force: true });
