import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Renders the pictures of the robot from the same scene the page runs, so they can't drift apart: the first-paint poster,
// the 404 still, the share card and the head in the header. It needs a real GPU. Run it by hand after a change to the
// scene: npm run poster. Name some, as in npm run poster head, to render only those.
const work = mkdtempSync(join(tmpdir(), 'poster-'));
const entry = join(work, 'entry.ts');
writeFileSync(entry, `
import { startOffice } from '${resolve('src/client/office/index')}';
import { GLYPHS } from '${resolve('src/shared/font')}';

const settle = (office, ms) => { for (let i = 0; i < ms / 16; i++) office.draw(400 + i * 16, 0); };

function open(host) {
  const canvas = document.createElement('canvas');
  host.append(canvas);
  const size = { width: innerWidth, height: innerHeight, ratio: 1, wide: true };
  return startOffice(canvas, size, { opaque: true, fixed: true }).then((office) => ({ office, canvas }));
}

function bitmap(ctx, value, x, y, scale, color) {
  ctx.fillStyle = color;
  let at = x;
  for (const char of value.toUpperCase()) {
    (GLYPHS[char] ?? []).forEach((bits, row) => {
      for (let col = 0; col < 5; col++) if (bits & (1 << (4 - col))) ctx.fillRect(at + col * scale, y + row * scale, scale, scale);
    });
    at += 6 * scale;
  }
}

async function head(host, pose) {
  const { office, canvas } = await open(host);
  office.still(pose);
  settle(office, 3000);
  office.look(1.5, 6.75, 7.6, -0.14, 6.32, 0, 13.5);
  office.draw(4000, 0);
  return canvas.toDataURL('image/webp', 0.86);
}

const views = {
  // Asleep, because that's the real state whenever no shift is open.
  async poster(host) {
    const { office, canvas } = await open(host);
    office.still('asleep');
    settle(office, 3000);
    return canvas.toDataURL('image/webp', 0.86);
  },
  async shrug(host) {
    const { office, canvas } = await open(host);
    office.still('shrug');
    settle(office, 500);
    office.look(0, 5.5, 8.6, 0, 5.05, 0, 26);
    office.draw(900, 0);
    return canvas.toDataURL('image/webp', 0.9);
  },
  async card(host) {
    const { office, canvas } = await open(host);
    office.still('rest');
    settle(office, 500);
    office.look(-1.9, 6.0, 8.6, -1.42, 5.55, 0, 23);
    office.draw(900, 0);
    const card = document.createElement('canvas');
    card.width = canvas.width;
    card.height = canvas.height;
    const ctx = card.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    bitmap(ctx, 'WE HIRED AN', 56, 196, 7, '#eae6dc');
    bitmap(ctx, 'AI INTERN.', 56, 262, 7, '#eae6dc');
    bitmap(ctx, 'HOLDERS ARE', 56, 340, 7, '#ff9a3c');
    bitmap(ctx, 'ITS BOSS.', 56, 406, 7, '#ff9a3c');
    bitmap(ctx, 'AGENTINTERN.ONLINE', 56, 520, 3, '#aeb8c8');
    return card.toDataURL('image/jpeg', 0.9);
  },
};
views.head = (host) => head(host, 'rest');
views.headAsleep = (host) => head(host, 'asleep');
window.render = (name) => views[name](document.getElementById('host'));
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
  response.end('<!doctype html><style>body{margin:0}#host{width:100vw;height:100vh}canvas{display:block}</style><div id="host"></div><script type="module" src="/poster.js"></script>');
}).listen(0);
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, file, width, height] of [['poster', 'robot-poster.webp', 1280, 800], ['shrug', 'robot-shrug.webp', 800, 800], ['card', 'share-card.jpg', 1200, 630], ['head', 'robot-head.webp', 176, 176], ['headAsleep', 'robot-head-asleep.webp', 176, 176]]) {
  const only = process.argv.slice(2);
  if (only.length > 0 && !only.some((pick) => name.startsWith(pick))) continue;
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => console.log(String(error)));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => 'render' in window);
  const dataUrl = await page.evaluate((view) => window.render(view), name);
  await page.close();
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (!/^data:image\/(webp|jpeg)/.test(dataUrl)) throw new Error(`the browser did not encode ${file}`);
  writeFileSync(`public/img/${file}`, bytes);
  console.log(`public/img/${file}, ${Math.round(bytes.length / 1024)} KB`);
}
await browser.close();
server.close();
rmSync(work, { recursive: true, force: true });
