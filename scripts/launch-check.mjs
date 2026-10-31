import { readFileSync } from 'node:fs';

// Prints a pass or fail list before launch. It only reads. Run: npm run launch:check [site url]
const SITE = process.argv[2] ?? 'https://agentintern.online';
const GAME = new URL(SITE).origin.replace('://', '://play.');
const token = JSON.parse(readFileSync('config/token.json', 'utf8'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const getJson = async (path) => {
  const response = await fetch(`${SITE}${path}`);
  return response.ok ? response.json() : null;
};
const head = async (url) => {
  try {
    return (await fetch(url, { redirect: 'follow' })).status;
  } catch {
    return 0;
  }
};

const health = await getJson('/api/health');
check('health answers', health?.ok === true, health ? `database ${health.database}, mode ${health.mode}` : 'no answer');
check('not paused', health?.paused === false);

const status = await getJson('/api/status');
check('the game is live', status?.game?.ok === true, `v${status?.game?.version ?? '?'}`);
check('balance reads work', status?.rpc?.state === 'ok', status?.rpc?.state ?? 'unknown');
check('the gate has run', (status?.gate?.length ?? 0) > 0, `${status?.gate?.length ?? 0} recent results`);

const manifest = await getJson('/.well-known/agent-intern.json');
check('a real intern shift has run', (manifest?.shifts?.realIntern ?? 0) > 0, `${manifest?.shifts?.realIntern ?? 0} so far`);
check('a real intern shift has shipped', (manifest?.shifts?.realInternShipped ?? 0) > 0);

const state = await getJson('/api/state');
check('there is an open round', state?.round?.status === 'open', `round ${state?.round?.id}`);
check('votes are public', Boolean(await getJson(`/api/votes/${state?.round?.id}`)));

check('the mint is set in config', Boolean(token.mint), token.mint ? '' : 'empty: TEST MODE stays on');
check('the site is out of TEST MODE', health?.mode === 'live');
check('creator fees are stated', Boolean(token.creatorFees), token.creatorFees ? '' : 'empty: you decide this');
check('the threshold is set', Number(token.threshold) > 0, String(token.threshold));

const practice = await fetch(`${SITE}/practice`);
check('the practice board is up', practice.ok);

const siteHeaders = (await fetch(`${SITE}/`)).headers;
const siteCsp = siteHeaders.get('content-security-policy') ?? '';
check('the site has a strict policy', siteCsp.includes("script-src 'self'") && !siteCsp.includes('unsafe'));
check('the site sets HSTS', Boolean(siteHeaders.get('strict-transport-security')));
const gameCsp = (await fetch(`${GAME}/`)).headers.get('content-security-policy') ?? '';
check('the game has no network', gameCsp.includes("connect-src 'none'"));
check('the game is sandboxed', gameCsp.includes('sandbox allow-scripts') && !gameCsp.includes('allow-same-origin'));

const proof = await (await fetch(`${SITE}/proof`)).text();
const links = [...new Set([...proof.matchAll(/href="([^"#]+)"/g)].map((m) => m[1]))]
  .filter((href) => !/\.(css|svg|webmanifest|xml|txt)$/.test(href) && href !== '/');
let broken = 0;
for (const href of links) {
  const url = href.startsWith('http') ? href : `${SITE}${href}`;
  const code = await head(url);
  if (code >= 400 || code === 0) {
    broken++;
    console.log(`      broken: ${href} (${code})`);
  }
  await new Promise((done) => setTimeout(done, 250));
}
check('every proof link opens', broken === 0, `${links.length} links`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} ready.`);
if (failed.length) {
  console.log('Not ready yet:');
  for (const f of failed) console.log(`  - ${f.name}`);
}
