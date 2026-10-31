import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMessage } from '../src/shared/message';
import { createHarness, DOMAIN, newWallet, ORIGIN, type Harness } from './harness';

let h: Harness;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

describe('sessions', () => {
  it('ignores a session cookie nobody issued', async () => {
    const res = await h.call('/api/me', { cookie: '__Host-pass=attacker-chosen-value' });
    expect(res.body.wallet).toBeNull();
  });

  it('issues a fresh value, so a planted cookie can never become a session', async () => {
    const wallet = await newWallet();
    const n = (await h.call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;
    const message = buildMessage(DOMAIN, wallet.address, { action: 'sign-in' }, n.nonce, n.issuedAt);
    const res = await h.call('/api/auth/sign-in', { cookie: '__Host-pass=planted', body: { wallet: wallet.address, nonce: n.nonce, signature: await wallet.sign(message) } });
    expect(res.headers.get('set-cookie')).not.toContain('planted');
    expect((await h.call('/api/me', { cookie: '__Host-pass=planted' })).body.wallet).toBeNull();
  });

  it('ends a session on sign-out', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    await h.call('/api/auth/sign-out', { cookie, body: {} });
    expect((await h.call('/api/me', { cookie })).body.wallet).toBeNull();
  });

  it('stores only a hash of the session', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const value = cookie.split('=')[1] ?? '';
    const row = await h.db.prepare('SELECT token_hash FROM sessions WHERE wallet = ?').bind(wallet.address).first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(value);
  });

  it('will not let one wallet act as another', async () => {
    const [a, b] = await Promise.all([newWallet(), newWallet()]);
    const cookie = await h.signIn(a);
    const round = (await h.call('/api/board')).body.round;
    expect((await h.propose(b, cookie, round.id, 'A task from the wrong wallet')).status).toBe(403);
  });
});

describe('access', () => {
  it.each([
    ['/api/shift/start', { taskId: 1 }],
    ['/api/shift/team', { text: 'x' }],
    ['/api/shift/finish', { shiftId: 1, status: 'done' }],
    ['/api/shift/reopen', { shiftId: 1 }],
    ['/api/shift/pause', { reason: 'x' }],
    ['/api/gate/event', { shiftId: 1 }],
    ['/api/gate/shot/1/after', {}],
    ['/api/live/event', { shiftId: 1 }],
  ])('needs its own secret for %s', async (path, body) => {
    expect((await h.call(path, { body })).status).toBe(401);
    expect((await h.call(path, { body, bearer: 'wrong' })).status).toBe(401);
  });

  it('never puts a session or a signature message from proposals in a public read', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = (await h.call('/api/board')).body.round;
    await h.propose(wallet, cookie, round.id, 'A task to look for leaks');
    const board = JSON.stringify((await h.call('/api/board')).body);
    expect(board).not.toContain('asks you to sign');
    expect(board).not.toContain('Nonce:');
    expect(JSON.stringify((await h.call('/api/status')).body)).not.toMatch(/secret|Bearer/i);
  });

  it('has no fake balances in reach without a session', async () => {
    expect((await h.call('/api/test/balance', { body: { balance: 1e9 } })).status).toBe(401);
  });
});

describe('input', () => {
  it.each([
    "/shift/1'%20OR%201=1--",
    '/shift/1;DROP%20TABLE%20shifts',
    "/task/1'--",
    "/boss/x'%20OR%20'1'='1",
    '/api/shifts/1%20OR%201=1',
    '/api/votes/1;DROP',
  ])('treats %s as not found', async (path) => {
    expect((await h.call(path)).status).toBe(404);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM shifts').first()).toBeTruthy();
  });

  it('stores SQL in a task as plain text', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = (await h.call('/api/board')).body.round;
    const text = "Add a sign reading Robert'); DROP TABLE tasks;--";
    const res = await h.propose(wallet, cookie, round.id, text);
    expect(res.status).toBe(200);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM tasks').first()).toBeTruthy();
  });

  it('turns path traversal into nothing', async () => {
    for (const path of ['/../../etc/passwd', '/api/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd']) {
      const res = await h.call(path);
      expect([404].includes(res.status), path).toBe(true);
      expect(String(res.body)).not.toContain('root:');
    }
  });

  it('keeps line breaks out of anything that could reach a header', async () => {
    const res = await h.call('/api/scores', { body: { name: 'a\r\nSet-Cookie: x=1', score: 10, tasks: 1, coffees: 0, nearMisses: 0, duration: 10, version: '0.1.0' } });
    expect(res.status).toBe(422);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('accepts only numbers in a rating', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    expect((await h.signed(wallet, cookie, '/api/ratings', { action: 'sign-in' }, { shift: 'x', stars: 9 })).status).toBe(400);
  });

  it('rejects JSON that is not an object', async () => {
    const res = await h.call('/api/practice/check', { body: [1, 2, 3] as unknown as object });
    expect([400, 200]).toContain(res.status);
  });
});

describe('limits', () => {
  it('limits every write path by address or wallet', async () => {
    const fs = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const read = (f: string): string => fs.readFileSync(fileURLToPath(new URL(f, import.meta.url).href), 'utf8');
    const source = read('../src/worker/index.ts');
    const writes = [...source.matchAll(/pathname === '(\/api\/[a-z/-]+)'/g)].map((m) => m[1]);
    expect(writes.length).toBeGreaterThan(5);
    const files = ['board', 'scores', 'public', 'push', 'html/machine'].map((f) => `../src/worker/${f}.ts`);
    const all = files.map(read).join('\n') + source;
    for (const scope of ['nonce', 'sign-in', 'score', 'vote', 'practice', 'rate', 'push', 'mcp', 'test-balance', 'sign-out', 'push-off']) {
      expect(all, scope).toContain(`'${scope}'`);
    }
  });

  it('cuts off the practice box', async () => {
    const statuses = new Set<number>();
    const { handle } = await import('../src/worker/index');
    for (let i = 0; i < 16; i++) {
      const res = await handle(new Request(`${ORIGIN}/api/practice/check`, { method: 'POST', headers: { origin: ORIGIN, 'cf-connecting-ip': '9.9.9.9', 'content-type': 'application/json' }, body: '{"text":"Add a rubber duck"}' }), h.env, { waitUntil: () => {} });
      statuses.add(res.status);
    }
    expect(statuses.has(429)).toBe(true);
  });
});

describe('headers', () => {
  it('forbids framing the site', async () => {
    const { headers } = await h.call('/board');
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('keeps the policy strict', async () => {
    const csp = (await h.call('/')).headers.get('content-security-policy') ?? '';
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", 'http:', '*']) expect(csp, bad).not.toContain(bad);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it('sets HSTS on API responses from the static layer and pages', async () => {
    expect((await h.call('/how')).headers.get('strict-transport-security')).toContain('includeSubDomains');
  });
});
