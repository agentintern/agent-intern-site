import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Renders the first-paint poster from the same scene the page runs, so the two can't drift apart. It needs a real GPU.
// Run it by hand after a change to the scene: node scripts/render-poster.mjs
const WIDTH = 1600;
const HEIGHT = 1000;
const QUALITY = 0.92;
const work = mkdtempSync(join(tmpdir(), 'poster-'));
const entry = join(work, 'entry.ts');
writeFileSync(entry, `
import { startOffice } from '${resolve('src/client/office/index')}';
window.render = async () => {
  const office = await startOffice(document.getElementById('host'), { pixelRatio: 1 });
  office.draw(400);
  office.draw(416);
  return office.canvas.toDataURL('image/webp', ${QUALITY});
};
`);
await build({ entryPoints: [entry], bundle: true, format: 'esm', outfile: join(work, 'poster.js'), target: 'es2022', logLevel: 'error' });
const script = readFileSync(join(work, 'poster.js'));
const server = createServer((request, response) => {
  if (request.url === '/poster.js') {
    response.setHeader('content-type', 'text/javascript');
    response.end(script);
    return;
  }
  response.setHeader('content-type', 'text/html');
  response.end('<!doctype html><style>body{margin:0}#host{width:100vw;height:100vh}</style><div id="host"></div><script type="module" src="/poster.js"></script>');
}).listen(0);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction(() => 'render' in window);
const dataUrl = await page.evaluate(() => window.render());
await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
if (!dataUrl.startsWith('data:image/webp')) throw new Error('the browser did not encode a WebP');
const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
writeFileSync('public/img/robot-poster.webp', bytes);
console.log(`public/img/robot-poster.webp, ${Math.round(bytes.length / 1024)} KB`);
