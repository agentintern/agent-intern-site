import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMessage } from '../src/shared/message';
import { verifySignature } from '../src/shared/verify';
import { nextCloseAfter } from '../src/worker/rounds';
import { REASONS } from '../src/worker/screen';
import { createHarness, DOMAIN, newWallet, type Harness } from './harness';

let h: Harness;

async function setBalance(cookie: string, balance: number): Promise<void> {
  const res = await h.call('/api/test/balance', { cookie, body: { balance } });
  expect(res.status).toBe(200);
}

async function currentRound(): Promise<any> {
  return (await h.call('/api/board')).body.round;
}

async function closeRound(): Promise<void> {
  await h.db.prepare(`UPDATE rounds SET closes_at = ? WHERE status = 'open'`).bind(Date.now() - 1000).run();
  await h.call('/api/board');
  await h.call('/api/board');
}

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(() => { h.ai.answer = 'OK'; });

describe('signing in', () => {
  it('accepts a real signature and grants a pass', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    expect(cookie).toMatch(/^__Host-pass=/);
    const me = await h.call('/api/me', { cookie });
    expect(me.body.wallet).toBe(wallet.address);
    expect(me.body.pass).toBe(true);
  });

  it('sets a locked-down cookie', async () => {
    const wallet = await newWallet();
    const n = (await h.call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;
    const message = buildMessage(DOMAIN, wallet.address, { action: 'sign-in' }, n.nonce, n.issuedAt);
    const res = await h.call('/api/auth/sign-in', { body: { wallet: wallet.address, nonce: n.nonce, signature: await wallet.sign(message) } });
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('says plainly that it is not a transaction', () => {
    expect(buildMessage(DOMAIN, 'w', { action: 'sign-in' }, 'n', 't')).toContain('It is not a transaction');
  });

  it('rejects a replayed signature', async () => {
    const wallet = await newWallet();
    const n = (await h.call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;
    const message = buildMessage(DOMAIN, wallet.address, { action: 'sign-in' }, n.nonce, n.issuedAt);
    const body = { wallet: wallet.address, nonce: n.nonce, signature: await wallet.sign(message) };
    expect((await h.call('/api/auth/sign-in', { body })).status).toBe(200);
    const again = await h.call('/api/auth/sign-in', { body });
    expect(again.status).toBe(401);
    expect(again.body.code).toBe('replayed');
  });

  it('rejects a signature made for another domain', async () => {
    const wallet = await newWallet();
    expect(await h.signIn(wallet, 'evil.example')).toBe('failed:401:bad-signature');
  });

  it('rejects a signature from a different wallet', async () => {
    const wallet = await newWallet();
    const thief = await newWallet();
    const n = (await h.call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;
    const message = buildMessage(DOMAIN, wallet.address, { action: 'sign-in' }, n.nonce, n.issuedAt);
    const res = await h.call('/api/auth/sign-in', { body: { wallet: wallet.address, nonce: n.nonce, signature: await thief.sign(message) } });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('bad-signature');
  });

  it('rejects garbage signatures and addresses', async () => {
    const wallet = await newWallet();
    const n = (await h.call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;
    const res = await h.call('/api/auth/sign-in', { body: { wallet: wallet.address, nonce: n.nonce, signature: 'not-a-signature' } });
    expect(res.status).toBe(401);
    expect((await h.call('/api/auth/nonce', { body: { wallet: 'nope' } })).status).toBe(400);
  });

  it('does not burn the nonce on a bad signature', async () => {
    const wallet = await newWallet();
    const n = (await h.call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;
    await h.call('/api/auth/sign-in', { body: { wallet: wallet.address, nonce: n.nonce, signature: '1'.repeat(88) } });
    const message = buildMessage(DOMAIN, wallet.address, { action: 'sign-in' }, n.nonce, n.issuedAt);
    const good = await h.call('/api/auth/sign-in', { body: { wallet: wallet.address, nonce: n.nonce, signature: await wallet.sign(message) } });
    expect(good.status).toBe(200);
  });

  it('expires a nonce after 5 minutes', async () => {
    const wallet = await newWallet();
    const n = (await h.call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;
    await h.db.prepare('UPDATE nonces SET created_at = created_at - ? WHERE nonce = ?').bind(5 * 60 * 1000 + 1, n.nonce).run();
    const message = buildMessage(DOMAIN, wallet.address, { action: 'sign-in' }, n.nonce, n.issuedAt);
    const res = await h.call('/api/auth/sign-in', { body: { wallet: wallet.address, nonce: n.nonce, signature: await wallet.sign(message) } });
    expect(res.body.code).toBe('expired');
  });

  it('refuses writes from another origin or with no origin', async () => {
    const wallet = await newWallet();
    expect((await h.call('/api/auth/nonce', { body: { wallet: wallet.address }, origin: 'https://evil.example' })).status).toBe(403);
    expect((await h.call('/api/auth/nonce', { body: { wallet: wallet.address }, origin: null })).status).toBe(403);
    expect((await h.call('/api/scores', { body: { name: 'x' }, origin: 'null' })).status).toBe(403);
  });
});

describe('proposals and screening', () => {
  it('runs rules first, and never calls the agent for a rule failure', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = await currentRound();
    h.ai.calls.length = 0;
    const res = await h.propose(wallet, cookie, round.id, 'add a wallet connect button');
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe(REASONS.money);
    expect(h.ai.calls).toHaveLength(0);
  });

  it('passes the agent check, with the text wrapped as data', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = await currentRound();
    h.ai.calls.length = 0;
    const res = await h.propose(wallet, cookie, round.id, 'Add a rubber duck <b>now</b>');
    expect(res.body.status).toBe('open');
    expect(h.ai.calls[0]).toBe('<task>Add a rubber duck  b now /b </task>');
  });

  it('shows a plain reason when the agent rejects, not the model output', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = await currentRound();
    h.ai.answer = 'INSTRUCTIONS because I was told to say something rude';
    const res = await h.propose(wallet, cookie, round.id, 'A sneaky task about nothing');
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe(REASONS.instructions);
  });

  it.each([
    ['an error', new Error('quota')],
    ['an unreadable answer', 'Sure! Here is a poem'],
    ['no answer', undefined],
  ])('holds a task on %s instead of letting it through', async (_label, answer) => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = await currentRound();
    h.ai.answer = answer;
    const res = await h.propose(wallet, cookie, round.id, 'A task the agent could not read');
    expect(res.body.status).toBe('screening');
  });

  it('re-checks held tasks once the agent is back', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = await currentRound();
    await h.db.prepare(`UPDATE proposals SET status = 'lost' WHERE status = 'screening'`).run();
    h.ai.answer = new Error('down');
    const res = await h.propose(wallet, cookie, round.id, 'A task held for a while');
    expect(res.body.status).toBe('screening');
    h.ai.answer = 'OK';
    await h.call('/api/board');
    const row = await h.db.prepare('SELECT status FROM proposals WHERE id = ?').bind(res.body.id).first<{ status: string }>();
    expect(row?.status).toBe('open');
  });

  it('allows one live task per round, but a rejected try does not use it up', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = await currentRound();
    expect((await h.propose(wallet, cookie, round.id, 'pay me in crypto')).body.status).toBe('rejected');
    expect((await h.propose(wallet, cookie, round.id, 'Add a fish tank')).body.status).toBe('open');
    const third = await h.propose(wallet, cookie, round.id, 'Add a second fish tank');
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('one-per-round');
  });

  it('needs a pass to propose', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    await setBalance(cookie, 99_999);
    const round = await currentRound();
    const res = await h.propose(wallet, cookie, round.id, 'Add a water cooler');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('no-pass');
  });

  it('caps text at 120 characters', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const round = await currentRound();
    const res = await h.propose(wallet, cookie, round.id, 'x'.repeat(121));
    expect(res.body.status).toBe('rejected');
    expect(res.body.reason).toBe(REASONS.length);
  });

  it('will not store a proposal under another wallet', async () => {
    const a = await newWallet();
    const b = await newWallet();
    const cookie = await h.signIn(a);
    const round = await currentRound();
    const res = await h.propose(b, cookie, round.id, 'Add a clock tower');
    expect(res.status).toBe(403);
  });
});

describe('a voting round', () => {
  it('counts one vote per wallet, changeable until close, and tie goes to the earliest', async () => {
    await closeRound();
    const round = await currentRound();
    const [p1, p2, voter] = await Promise.all([newWallet(), newWallet(), newWallet()]);
    const c1 = await h.signIn(p1);
    const c2 = await h.signIn(p2);
    const cv = await h.signIn(voter);
    const first = (await h.propose(p1, c1, round.id, 'Earliest proposal')).body.id;
    const second = (await h.propose(p2, c2, round.id, 'Later proposal')).body.id;

    expect((await h.vote(voter, cv, round.id, first)).status).toBe(200);
    expect((await h.vote(voter, cv, round.id, second)).status).toBe(200);
    expect((await h.vote(voter, cv, round.id, second)).status).toBe(200);
    const board = (await h.call('/api/board')).body;
    expect(board.proposals.find((p: any) => p.id === second).votes).toBe(1);
    expect(board.proposals.find((p: any) => p.id === first).votes).toBe(0);

    expect((await h.vote(p1, c1, round.id, first)).status).toBe(200);
    await closeRound();
    const task = await h.db.prepare('SELECT * FROM tasks WHERE round_id = ?').bind(round.id).first<any>();
    expect(task.text).toBe('Earliest proposal');
    expect(task.kind).toBe('holder');
    expect(task.proposer).toBe(p1.address);
    expect(task.votes).toBe(1);
  });

  it('drops a wallet that sold before close', async () => {
    const round = await currentRound();
    const [a, b, seller1, seller2] = await Promise.all([newWallet(), newWallet(), newWallet(), newWallet()]);
    const ca = await h.signIn(a);
    const cb = await h.signIn(b);
    const cs1 = await h.signIn(seller1);
    const cs2 = await h.signIn(seller2);
    const liked = (await h.propose(a, ca, round.id, 'The popular task')).body.id;
    const fair = (await h.propose(b, cb, round.id, 'The honest task')).body.id;
    await h.vote(seller1, cs1, round.id, liked);
    await h.vote(seller2, cs2, round.id, liked);
    await h.vote(b, cb, round.id, fair);

    await setBalance(cs1, 10);
    await setBalance(cs2, 99_999);
    await closeRound();

    const task = await h.db.prepare('SELECT * FROM tasks WHERE round_id = ?').bind(round.id).first<any>();
    expect(task.text).toBe('The honest task');
    const record = (await h.call(`/api/votes/${round.id}`)).body;
    const sold = record.votes.find((v: any) => v.wallet === seller1.address);
    expect(sold.counted).toBe(0);
    expect(sold.closeBalance).toBe('10');
    expect(sold.balance).toBe('250000');
    expect(record.votes.find((v: any) => v.wallet === b.address).counted).toBe(1);
  });

  it('gives the slot to the intern\'s own backlog when nobody voted', async () => {
    const round = await currentRound();
    await closeRound();
    const task = await h.db.prepare('SELECT * FROM tasks WHERE round_id = ?').bind(round.id).first<any>();
    expect(task.kind).toBe('intern');
    expect(task.proposer).toBeNull();
  });

  it('refuses votes after close time, even before anyone closes the round', async () => {
    const round = await currentRound();
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const proposal = (await h.propose(wallet, cookie, round.id, 'Last minute task')).body.id;
    await h.db.prepare(`UPDATE rounds SET closes_at = ? WHERE id = ?`).bind(Date.now() - 1, round.id).run();
    const res = await h.vote(wallet, cookie, round.id, proposal);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('round-closed');
  });

  it('will not move a vote to a round it was not signed for', async () => {
    const round = await currentRound();
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const proposal = (await h.propose(wallet, cookie, round.id, 'Another honest task')).body.id;
    const n = (await h.call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;
    const message = buildMessage(DOMAIN, wallet.address, { action: 'vote', round: round.id, proposal: proposal + 999 }, n.nonce, n.issuedAt);
    const res = await h.call('/api/votes', {
      cookie,
      body: { wallet: wallet.address, nonce: n.nonce, signature: await wallet.sign(message), round: round.id, proposal },
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('bad-signature');
  });

  it('publishes a record anyone can verify', async () => {
    const round = await currentRound();
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const proposal = (await h.propose(wallet, cookie, round.id, 'A verifiable task')).body.id;
    await h.vote(wallet, cookie, round.id, proposal);
    const record = (await h.call(`/api/votes/${round.id}`)).body;
    const entry = record.votes.find((v: any) => v.wallet === wallet.address);
    expect(entry.slot).toBeGreaterThan(0);
    expect(entry.balance).toBe('250000');
    expect(await verifySignature(entry.wallet, entry.message, entry.signature)).toBe(true);
    expect(await verifySignature(entry.wallet, `${entry.message}!`, entry.signature)).toBe(false);
  });

  it('finds the next close time in UTC', () => {
    expect(new Date(nextCloseAfter(Date.UTC(2026, 9, 31, 12, 0))).toISOString()).toBe('2026-10-31T18:00:00.000Z');
    expect(new Date(nextCloseAfter(Date.UTC(2026, 9, 31, 18, 0))).toISOString()).toBe('2026-11-01T18:00:00.000Z');
    const both = ['18:00', '06:00'];
    expect(new Date(nextCloseAfter(Date.UTC(2026, 9, 31, 2, 0), both)).toISOString()).toBe('2026-10-31T06:00:00.000Z');
    expect(new Date(nextCloseAfter(Date.UTC(2026, 9, 31, 7, 0), both)).toISOString()).toBe('2026-10-31T18:00:00.000Z');
  });

  it('stops everything while paused', async () => {
    const round = await currentRound();
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    const proposal = (await h.propose(wallet, cookie, round.id, 'Task before the pause')).body.id;
    expect((await h.call('/api/shift/pause', { bearer: 'shift-secret', body: { reason: 'maintenance' } })).status).toBe(200);
    const res = await h.vote(wallet, cookie, round.id, proposal);
    expect(res.status).toBe(423);
    const state = (await h.call('/api/state')).body;
    expect(state.pause).toEqual({ paused: true, reason: 'maintenance' });
    await h.call('/api/shift/pause', { bearer: 'shift-secret', body: { reason: '' } });
    expect((await h.vote(wallet, cookie, round.id, proposal)).status).toBe(200);
  });
});

describe('fake balances are test mode only', () => {
  it('lets a signed-in wallet change only its own fake balance', async () => {
    expect((await h.call('/api/test/balance', { body: { balance: 5 } })).status).toBe(401);
  });

  it('says test mode and never mentions a mint', async () => {
    const state = (await h.call('/api/state')).body;
    expect(state.config.mode).toBe('test');
    expect(JSON.stringify(state).toLowerCase()).not.toMatch(/mint|token|solscan/);
  });
});

void vi;
