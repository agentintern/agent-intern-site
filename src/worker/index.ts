import { CLEAR_COOKIE, createSession, dropSession, sessionWallet, verifySigned, type SignedRequest } from './auth';
import { meetsThreshold, readBalance } from './balance';
import { testMode, threshold } from './config';
import { propose, publicVotes, requestNonce, setTestBalance, vote } from './board';
import { shipCard } from './card';
import type { Ctx, Env } from './env';
import { HttpError, json, readJson, requireBearer, requireSameOrigin } from './http';
import { advance } from './rounds';
import { finishShift, getShift, readShot, receiveGateEvent, receiveLiveEvent, reopenShift, setPaused, startShift, storeShot } from './shifts';
import { leaderboard, submitScore } from './scores';
import { board, changelog, homeState, liveFeed, shiftDetail, shiftHistory, status } from './status';

const MAX_SHOT_BYTES = 650_000;

async function route(request: Request, env: Env, ctx: Ctx, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;
  let match: RegExpMatchArray | null;

  if (method === 'GET' || method === 'HEAD') {
    if (pathname === '/api/state') return json(await homeState(env), { maxAge: 4 });
    if (pathname === '/api/board') return json(await board(env), { maxAge: 3 });
    if (pathname === '/api/live') {
      const after = Number(url.searchParams.get('after') ?? 0);
      return json(await liveFeed(env, Number.isFinite(after) ? after : 0), { maxAge: 3 });
    }
    if (pathname === '/api/status') return json(await status(env), { maxAge: 15 });
    if (pathname === '/api/shifts') return json(await shiftHistory(env), { maxAge: 10 });
    if (pathname === '/api/changelog') return json(await changelog(env), { maxAge: 30 });
    if (pathname === '/api/leaderboard') return json({ scores: await leaderboard(env) }, { maxAge: 10 });
    if ((match = pathname.match(/^\/api\/shifts\/(\d+)$/))) {
      return json(await shiftDetail(env, Number(match[1])), { maxAge: 5 });
    }
    if ((match = pathname.match(/^\/api\/shifts\/(\d+)\/shot\/(before|after)\.png$/))) {
      const bytes = await readShot(env, Number(match[1]), match[2] as string);
      if (!bytes) throw new HttpError(404, 'No such image.');
      return new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' } });
    }
    if ((match = pathname.match(/^\/api\/shifts\/(\d+)\/card\.png$/))) {
      const shift = await getShift(env, Number(match[1]));
      if (!shift) throw new HttpError(404, 'No such shift.');
      const png = await shipCard(shift);
      const open = shift.status === 'live' || shift.status === 'gate';
      return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${open ? 30 : 3600}`, 'x-content-type-options': 'nosniff' } });
    }
    if ((match = pathname.match(/^\/api\/votes\/(\d+)$/))) {
      return json(await publicVotes(env, Number(match[1])), { maxAge: 5 });
    }
    if (pathname === '/api/votes' || pathname === '/api/votes/') {
      const round = await advance(env);
      return json(await publicVotes(env, round.id), { maxAge: 5 });
    }
    if (pathname === '/api/me') {
      const wallet = await sessionWallet(env, request);
      if (!wallet) return json({ wallet: null });
      const round = await advance(env);
      const myVote = await env.DB.prepare('SELECT proposal_id AS proposal FROM votes WHERE round_id = ? AND wallet = ?')
        .bind(round.id, wallet).first<{ proposal: number }>();
      try {
        const balance = await readBalance(env, wallet);
        return json({ wallet, balance: balance.display, slot: balance.slot, pass: meetsThreshold(balance), threshold: threshold(), vote: myVote?.proposal ?? null });
      } catch (cause) {
        if (cause instanceof HttpError && cause.code === 'rpc-down') {
          return json({ wallet, balance: null, pass: false, rpcDown: true, threshold: threshold(), vote: myVote?.proposal ?? null });
        }
        throw cause;
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');

  // Machine routes. Each token opens exactly one door, and none of them live in the container.
  if (pathname === '/api/live/event') {
    await requireBearer(request, env.WATCHER_TOKEN);
    return json(await receiveLiveEvent(env, await readJson(request)));
  }
  if (pathname === '/api/gate/event') {
    await requireBearer(request, env.GATE_TOKEN);
    return json(await receiveGateEvent(env, await readJson(request)));
  }
  if ((match = pathname.match(/^\/api\/gate\/shot\/(\d+)\/(before|after)$/))) {
    await requireBearer(request, env.GATE_TOKEN);
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_SHOT_BYTES) throw new HttpError(413, 'That image is too big.');
    await storeShot(env, Number(match[1]), match[2] as string, new Uint8Array(await request.arrayBuffer()));
    return json({ stored: true });
  }
  if (pathname.startsWith('/api/shift/')) {
    await requireBearer(request, env.SHIFT_TOKEN);
    const body = await readJson<Record<string, unknown>>(request);
    if (pathname === '/api/shift/start') return json({ shift: await startShift(env, body) });
    if (pathname === '/api/shift/finish') return json({ shift: await finishShift(env, body) });
    if (pathname === '/api/shift/reopen') return json({ shift: await reopenShift(env, body) });
    if (pathname === '/api/shift/pause') return json(await setPaused(env, body.reason));
    throw new HttpError(404, 'Not found.');
  }

  // Everything else is a person in a browser on our own pages.
  requireSameOrigin(request, env);

  if (pathname === '/api/auth/nonce') {
    const body = await readJson<{ wallet?: unknown }>(request);
    return json(await requestNonce(env, body.wallet));
  }
  if (pathname === '/api/auth/sign-in') {
    const body = await readJson<SignedRequest>(request);
    await verifySigned(env, body, { action: 'sign-in' });
    const balance = await readBalance(env, body.wallet);
    const cookie = await createSession(env, body.wallet);
    return json(
      { wallet: body.wallet, balance: balance.display, slot: balance.slot, pass: meetsThreshold(balance), threshold: threshold() },
      { headers: { 'set-cookie': cookie } },
    );
  }
  if (pathname === '/api/auth/sign-out') {
    await dropSession(env, request);
    return json({ ok: true }, { headers: { 'set-cookie': CLEAR_COOKIE } });
  }
  if (pathname === '/api/proposals') return json(await propose(env, ctx, request, await readJson(request)));
  if (pathname === '/api/votes') return json(await vote(env, request, await readJson(request)));
  if (pathname === '/api/scores') return json(await submitScore(env, request, await readJson(request)));
  if (pathname === '/api/test/balance' && testMode()) {
    const body = await readJson<{ balance?: unknown }>(request);
    return json(await setTestBalance(env, request, body.balance));
  }
  throw new HttpError(404, 'Not found.');
}

export async function handle(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  try {
    return await route(request, env, ctx, new URL(request.url));
  } catch (cause) {
    if (cause instanceof HttpError) {
      return json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    console.log('unhandled', cause instanceof Error ? cause.stack : String(cause));
    return json({ error: 'Something broke on our side.', code: 'server' }, { status: 500 });
  }
}
