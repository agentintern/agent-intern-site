import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/js', { recursive: true });
await cp('public', 'dist', { recursive: true });

await build({
  entryPoints: { app: 'src/client/app.ts' },
  bundle: true,
  minify: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  outdir: 'dist/js',
  chunkNames: 'chunk-[hash]',
  legalComments: 'none',
  logLevel: 'error',
});

// Classic script: it runs in an opaque origin, where module scripts would need CORS.
await build({
  entryPoints: { 'sandbox-try': 'src/client/sandbox-try.ts' },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  outdir: 'dist/js',
  legalComments: 'none',
  logLevel: 'error',
});

// The zone keeps these two for 4 hours whatever they say, so the URL has to change when they do. Chunk names already
// carry a hash, and app.js names them, so this covers all the JS.
const hash = createHash('sha256');
for (const file of ['dist/site.css', 'dist/js/app.js']) hash.update(await readFile(file));
await writeFile('config/assets.json', `${JSON.stringify({ version: hash.digest('hex').slice(0, 10) })}\n`);

await rm('dist/_headers', { force: true });
await writeFile('dist/_headers', await readFile('public/_headers', 'utf8'));
console.log('built');
