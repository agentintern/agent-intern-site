import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, newWallet, type Harness } from './harness';

// The fake mint: everything below runs the real-token code path against a mock RPC.
const FAKE_MINT = 'FakeMint1111111111111111111111111111111111111';
vi.mock('../config/token.json', () => ({ default: { mint: 'FakeMint1111111111111111111111111111111111111', threshold: 100000 } }));

let h: Harness;
const realFetch = globalThis.fetch;
let rpc: { balances: Map<string, { amount: string; decimals: number }[]>; down: boolean; calls: any[] };

function rpcResponse(wallet: string): Response {
  const accounts = rpc.balances.get(wallet) ?? [];
  return Response.json({
    jsonrpc: '2.0',
    id: 1,
    result: {
      context: { slot: 987654321 },
      value: accounts.map((a) => ({
        account: { data: { parsed: { info: { tokenAmount: a } } } },
      })),
    },
  });
}

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

beforeEach(() => {
  rpc = { balances: new Map(), down: false, calls: [] };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('solana.com')) return realFetch(input as RequestInfo, init);
    if (rpc.down) return new Response('nope', { status: 503 });
    const body = JSON.parse(String(init?.body));
    rpc.calls.push(body);
    return rpcResponse(body.params[0]);
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('with a mint set', () => {
  it('shows live mode and the mint', async () => {
    const state = (await h.call('/api/state')).body;
    expect(state.config.mode).toBe('live');
    expect(state.config.mint).toBe(FAKE_MINT);
  });

  it('asks the RPC by mint, and adds up every account of the wallet', async () => {
    const wallet = await newWallet();
    rpc.balances.set(wallet.address, [
      { amount: '60000000000', decimals: 6 },
      { amount: '40000000000', decimals: 6 },
    ]);
    const cookie = await h.signIn(wallet);
    const me = (await h.call('/api/me', { cookie })).body;
    expect(me.balance).toBe('100000');
    expect(me.pass).toBe(true);
    expect(me.slot).toBe(987654321);
    const request = rpc.calls[0];
    expect(request.method).toBe('getTokenAccountsByOwner');
    expect(request.params[1]).toEqual({ mint: FAKE_MINT });
  });

  it('does not round a balance up to the threshold', async () => {
    const wallet = await newWallet();
    rpc.balances.set(wallet.address, [{ amount: '99999999999', decimals: 6 }]);
    const cookie = await h.signIn(wallet);
    const me = (await h.call('/api/me', { cookie })).body;
    expect(me.pass).toBe(false);
    expect(me.balance).toBe('99999.999999');
  });

  it('handles amounts too large for a float', async () => {
    const wallet = await newWallet();
    rpc.balances.set(wallet.address, [{ amount: '18446744073709551615', decimals: 9 }]);
    const cookie = await h.signIn(wallet);
    expect((await h.call('/api/me', { cookie })).body.balance).toBe('18446744073.709551615');
  });

  it('has no fake balances', async () => {
    const wallet = await newWallet();
    const cookie = await h.signIn(wallet);
    expect((await h.call('/api/test/balance', { cookie, body: { balance: 999999 } })).status).toBe(404);
  });

  it('pauses voting when the RPC fails, and grants nothing', async () => {
    const wallet = await newWallet();
    rpc.balances.set(wallet.address, [{ amount: '500000000000', decimals: 6 }]);
    const cookie = await h.signIn(wallet);
    const round = (await h.call('/api/board')).body.round;
    const proposal = (await h.propose(wallet, cookie, round.id, 'Task with a working RPC')).body.id;

    rpc.down = true;
    const res = await h.vote(wallet, cookie, round.id, proposal);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('rpc-down');
    const votes = (await h.call(`/api/votes/${round.id}`)).body.votes;
    expect(votes.find((v: any) => v.wallet === wallet.address)).toBeUndefined();
    expect((await h.call('/api/status')).body.rpc.state).toBe('down');
  });

  it('will not close a round on an RPC outage, and finishes it later on real numbers', async () => {
    const wallet = await newWallet();
    rpc.balances.set(wallet.address, [{ amount: '500000000000', decimals: 6 }]);
    const cookie = await h.signIn(wallet);
    let round = (await h.call('/api/board')).body.round;
    const proposal = (await h.propose(wallet, cookie, round.id, 'Task through an outage')).body.id;
    expect((await h.vote(wallet, cookie, round.id, proposal)).status).toBe(200);

    rpc.down = true;
    await h.db.prepare(`UPDATE rounds SET closes_at = ? WHERE id = ?`).bind(Date.now() - 1, round.id).run();
    await h.call('/api/board');
    const stuck = await h.db.prepare('SELECT status FROM rounds WHERE id = ?').bind(round.id).first<{ status: string }>();
    expect(stuck?.status).toBe('closing');
    expect(await h.db.prepare('SELECT id FROM tasks WHERE round_id = ?').bind(round.id).first()).toBeNull();

    rpc.down = false;
    await h.call('/api/board');
    const task = await h.db.prepare('SELECT text FROM tasks WHERE round_id = ?').bind(round.id).first<{ text: string }>();
    expect(task?.text).toBe('Task through an outage');
    round = (await h.call('/api/board')).body.round;
    expect(round.status).toBe('open');
  });

  it('drops a seller at close on real balances', async () => {
    const [holder, seller] = await Promise.all([newWallet(), newWallet()]);
    rpc.balances.set(holder.address, [{ amount: '500000000000', decimals: 6 }]);
    rpc.balances.set(seller.address, [{ amount: '500000000000', decimals: 6 }]);
    const ch = await h.signIn(holder);
    const cs = await h.signIn(seller);
    const round = (await h.call('/api/board')).body.round;
    const proposal = (await h.propose(holder, ch, round.id, 'Task with a seller')).body.id;
    await h.vote(holder, ch, round.id, proposal);
    await h.vote(seller, cs, round.id, proposal);

    rpc.balances.set(seller.address, []);
    await h.db.prepare(`UPDATE rounds SET closes_at = ? WHERE id = ?`).bind(Date.now() - 1, round.id).run();
    await h.call('/api/board');

    const task = await h.db.prepare('SELECT votes FROM tasks WHERE round_id = ?').bind(round.id).first<{ votes: number }>();
    expect(task?.votes).toBe(1);
  });
});
