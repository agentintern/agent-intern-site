import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const tokenPath = process.env.TOKEN_CONFIG || 'config/token.json';
const token = JSON.parse(await readFile(tokenPath, 'utf8'));
const site = JSON.parse(await readFile('config/site.json', 'utf8'));
const tokenOn = Boolean(token.mint);
const siteOrigin = process.env.SITE_ORIGIN || site.siteOrigin;
const gameOrigin = process.env.GAME_ORIGIN || site.gameOrigin;

await rm('dist', { recursive: true, force: true });
await mkdir('dist/js', { recursive: true });
await cp('public', 'dist', { recursive: true });

// Pages are rendered once here, so they arrive complete and need no script to read.
await build({
  entryPoints: ['src/pages/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '.build/pages.mjs',
  logLevel: 'error',
});
const { pages, layout } = await import(`${pathToFileURL(`${process.cwd()}/.build/pages.mjs`).href}?${Date.now()}`);
const options = { tokenOn, mint: token.mint, threshold: token.threshold };
for (const page of pages(options)) {
  const html = layout(page, options)
    .replaceAll(site.gameOrigin, gameOrigin)
    .replaceAll(site.siteOrigin, siteOrigin);
  await writeFile(`dist/${page.file}`, html);
}

await build({
  entryPoints: {
    home: 'src/client/home.ts',
    play: 'src/client/play.ts',
    board: 'src/client/board.ts',
    live: 'src/client/live.ts',
    history: 'src/client/history.ts',
    shift: 'src/client/shift.ts',
    status: 'src/client/status.ts',
    changelog: 'src/client/changelog.ts',
    chrome: 'src/client/chrome-page.ts',
  },
  bundle: true,
  minify: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  outdir: 'dist/js',
  chunkNames: 'chunk-[hash]',
  legalComments: 'none',
  define: {
    __MINT__: JSON.stringify(token.mint),
    __TEST_MODE__: JSON.stringify(!tokenOn),
  },
  logLevel: 'error',
});

const headers = (await readFile('public/_headers', 'utf8')).replaceAll('__GAME_ORIGIN__', gameOrigin);
await writeFile('dist/_headers', headers);
await rm('.build', { recursive: true, force: true });
console.log(`built in ${tokenOn ? 'live' : 'test'} mode`);
