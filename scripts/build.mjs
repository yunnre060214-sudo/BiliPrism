import { build } from 'vite';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const [name, entry] of Object.entries({ content: 'src/content/main.ts', popup: 'src/popup/popup.ts', background: 'src/background/sw.ts' })) {
  await build({ configFile: false, publicDir: false, logLevel: 'warn', build: {
    outDir: 'dist', emptyOutDir: false, target: 'chrome110', minify: true,
    lib: { entry, name: `biliprism_${name}`, formats: ['iife'], fileName: () => `${name}.js` },
  } });
}
await build({ configFile: false, publicDir: false, logLevel: 'warn', build: {
  outDir: 'dist', emptyOutDir: false, target: 'chrome110', minify: true,
  lib: { entry: Object.fromEntries(['home', 'watch', 'space', 'message', 'history', 'feed', 'detail', 'enhancements'].map(n => [n, `src/content/pages/${n}.ts`])), formats: ['es'], fileName: (_f, n) => `pages/${n}.js` },
  rollupOptions: { output: { chunkFileNames: 'pages/chunk-[hash].js' } },
} });
await cp('public', 'dist', { recursive: true });
await cp('licenses', 'dist/licenses', { recursive: true });
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'INSTALL.md']) await cp(name, `dist/${name}`);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const mf = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
if (pkg.version !== mf.version) throw new Error('package.json 与 manifest.json 版本不一致');
await writeFile('dist/BUILD.json', JSON.stringify({ name: 'BiliPrism', version: pkg.version }, null, 2) + '\n');
console.log(`BiliPrism ${pkg.version} → dist/`);
