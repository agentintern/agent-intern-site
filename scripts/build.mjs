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

await rm('dist/_headers', { force: true });
await writeFile('dist/_headers', await readFile('public/_headers', 'utf8'));
console.log('built');
