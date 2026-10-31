import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import site from '../config/site.json' with { type: 'json' };

// Takes the screenshot the CRT shows, from the game that's really live, and records its version beside it, so the label
// can't drift from the picture. It only reads the game. Run it by hand after a release: node scripts/render-game-shot.mjs
const health = await (await fetch(`${site.gameOrigin}/health.json`)).json();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
await page.goto(`${site.gameOrigin}/`, { waitUntil: 'load' });
await page.waitForTimeout(900);
const dataUrl = await page.evaluate(() => {
  const source = document.querySelector('canvas');
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d').drawImage(source, 0, 0);
  return { url: copy.toDataURL('image/webp', 0.9), width: copy.width, height: copy.height };
}).catch(() => null);
const bytes = dataUrl ? Buffer.from(dataUrl.url.split(',')[1], 'base64') : null;
if (bytes) {
  writeFileSync('public/img/game-shot.webp', bytes);
} else {
  const png = await page.screenshot({ type: 'png' });
  const viewer = await browser.newPage();
  await viewer.goto('about:blank');
  const webp = await viewer.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const copy = document.createElement('canvas');
    copy.width = image.naturalWidth;
    copy.height = image.naturalHeight;
    copy.getContext('2d').drawImage(image, 0, 0);
    return copy.toDataURL('image/webp', 0.9);
  }, png.toString('base64'));
  writeFileSync('public/img/game-shot.webp', Buffer.from(webp.split(',')[1], 'base64'));
}
await browser.close();
writeFileSync('config/game-shot.json', `${JSON.stringify({ version: health.version })}\n`);
console.log(`game-shot.webp from v${health.version}`);
