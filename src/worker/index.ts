import { CLEAR_COOKIE, createSession, dropSession, sessionWallet, verifySigned, type SignedRequest } from './auth';
import { meetsThreshold, readBalance } from './balance';
import { dayNumber } from '../shared/daily';
import { siteOrigin, SITE, testMode, threshold } from './config';
import { propose, publicVotes, requestNonce, setTestBalance, vote } from './board';
import { bossCard, dailyCard, homeCard, shipCard, taskCard } from './card';
import type { Ctx, Env } from './env';
import { apiPage, aboutPage, brandPage, embedStatus, howPage, proofPage, sandboxFrame, sandboxPage, securityPage, tokenPage } from './html/content';
import { feed, llmsTxt, manifest, mcp, robots, securityTxt, sitemap } from './html/machine';
import { renderPage, type Page } from './html/layout';
import {
  boardPage, bossPage, breakPage, changelogPage, historyPage, homePage, hrPage, livePage, playPage, practicePage,
  promotionsPage, raw404, shiftPage, statusPage, taskPage, type Rendered,
} from './html/pages';
import { shiftLine } from './html/parts';
import { clientIp, HttpError, json, readJson, requireBearer, requireSameOrigin } from './http';
import { MINUTE, rateLimit } from './ratelimit';
import { bossProfile, getProposal, health, hallOfBosses, hrLog, overview, practiceCheck, promotionLevel, rateShift, recordFoundingBoss, shiftCounts } from './public';
import { sendPush, subscribePush, unsubscribePush, warnVoteClosing } from './push';
import { advance } from './rounds';
import { finishShift, getShift, readShot, receiveGateEvent, receiveLiveEvent, reopenShift, setPaused, startShift, startTeamChange, storeShot } from './shifts';
import { leaderboard, submitScore } from './scores';
import { changelog, homeState, liveFeed, shiftDetail, shiftHistory, status, board } from './status';

const MAX_SHOT_BYTES = 650_000;
const HTML_TTL = 15;

const gameAddress = (env: Env): string => env.GAME_ORIGIN || SITE.gameOrigin;

function csp(gameOrigin: string): string {
  return [
    `default-src 'none'`, `script-src 'self'`, `style-src 'self'`, `img-src 'self' data: blob:`, `font-src 'self'`,
    `connect-src 'self'`, `frame-src ${gameOrigin} 'self'`, `worker-src 'self'`, `manifest-src 'self'`,
    `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, `object-src 'none'`,
  ].join('; ');
}

const BASE_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

function htmlResponse(body: string, status: number, extra: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // no-transform stops the edge injecting anything into pages where people sign with a wallet.
      'cache-control': 'public, max-age=0, must-revalidate, no-transform',
      ...BASE_HEADERS,
      ...extra,
    },
  });
}

function pageResponse(env: Env, page: Rendered): Response {
  return htmlResponse(renderPage(env, page, page.state), page.status ?? 200, {
    'content-security-policy': csp(gameAddress(env)),
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin-allow-popups',
  });
}

// Reads are served from the edge for a few seconds, so a launch crowd doesn't turn into database load.
async function edgeCached(request: Request, env: Env, ctx: Ctx, ttl: number, build: () => Promise<Response>): Promise<Response> {
  if (typeof caches === 'undefined' || request.method !== 'GET') return build();
  const cache = (caches as unknown as { default: Cache }).default;
  const url = new URL(request.url);
  const key = new Request(`${url.origin}${url.pathname}${url.pathname === '/api/live' || url.pathname === '/api/leaderboard' ? url.search : ''}`);
  const hit = await cache.match(key);
  if (hit) {
    const served = new Response(hit.body, hit);
    served.headers.set('cache-control', hit.headers.get('x-browser-cache') ?? 'no-store');
    served.headers.delete('x-browser-cache');
    return served;
  }
  ctx.waitUntil(warnVoteClosing(env, url.origin).catch(() => undefined));
  const response = await build();
  if (response.ok) {
    const stored = new Response(response.clone().body, response);
    stored.headers.set('x-browser-cache', response.headers.get('cache-control') ?? 'no-store');
    stored.headers.set('cache-control', `public, s-maxage=${ttl}`);
    ctx.waitUntil(cache.put(key, stored));
  }
  return response;
}

// A person who just acted has to see it, so a write drops the cached reads it changed.
async function purge(request: Request, paths: string[]): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = (caches as unknown as { default: Cache }).default;
  const { origin } = new URL(request.url);
  await Promise.all(paths.map((path) => cache.delete(new Request(`${origin}${path}`))));
}

async function htmlRoute(env: Env, pathname: string, origin: string): Promise<Rendered | Response | null> {
  let match: RegExpMatchArray | null;
  switch (pathname) {
    case '/': return homePage(env);
    case '/play': return playPage(env);
    case '/board': return boardPage(env);
    case '/practice': return practicePage(env);
    case '/live': return livePage(env);
    case '/history': return historyPage(env);
    case '/hr': return hrPage(env);
    case '/break': return breakPage(env);
    case '/promotions': return promotionsPage(env);
    case '/how': return howPage(env);
    case '/about': return aboutPage(env);
    case '/status': return statusPage(env);
    case '/changelog': return changelogPage(env);
    case '/proof': return proofPage(env, origin);
    case '/proof/sandbox': return sandboxPage(env);
    case '/security': return securityPage(env);
    case '/brand': return brandPage(env);
    case '/api': return apiPage(env, origin);
    case '/token': return tokenPage(env);
    default: break;
  }
  if ((match = pathname.match(/^\/shift\/(\d{1,9})$/))) return shiftPage(env, Number(match[1]));
  if ((match = pathname.match(/^\/task\/(\d{1,9})$/))) return taskPage(env, Number(match[1]));
  if ((match = pathname.match(/^\/play\/(\d{1,6})$/))) return playPage(env, Number(match[1]));
  if ((match = pathname.match(/^\/boss\/([1-9A-HJ-NP-Za-km-z]{32,44})$/))) return bossPage(env, match[1] as string);
  return null;
}

const png = (bytes: BodyInit, maxAge: number): Response =>
  new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': `public, max-age=${maxAge}`, 'x-content-type-options': 'nosniff' } });

async function getRoute(request: Request, env: Env, ctx: Ctx, url: URL, origin: string): Promise<Response> {
  const { pathname } = url;
  let match: RegExpMatchArray | null;

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
  if (pathname === '/api/health') return json(await health(env));

  return edgeCached(request, env, ctx, HTML_TTL, async () => {
    if (pathname === '/api/state') return json(await homeState(env), { maxAge: 4 });
    if (pathname === '/api/board') return json(await board(env), { maxAge: 3 });
    if (pathname === '/api/live') {
      const after = Number(url.searchParams.get('after') ?? 0);
      return json(await liveFeed(env, Number.isFinite(after) ? after : 0), { maxAge: 3 });
    }
    if (pathname === '/api/status') return json(await status(env), { maxAge: 15 });
    if (pathname === '/api/shifts') return json(await shiftHistory(env), { maxAge: 10 });
    if (pathname === '/api/changelog') return json(await changelog(env), { maxAge: 30 });
    if (pathname === '/api/hr') return json(await hrLog(env), { maxAge: 30 });
    if (pathname === '/api/hall') return json({ bosses: await hallOfBosses(env) }, { maxAge: 60 });
    if (pathname === '/api/promotion') return json(promotionLevel((await shiftCounts(env)).internShipped), { maxAge: 60 });
    if (pathname === '/api/leaderboard') {
      const day = Number(url.searchParams.get('day') ?? 0);
      return json({ day: day || null, scores: await leaderboard(env, Number.isInteger(day) && day > 0 ? day : undefined) }, { maxAge: 10 });
    }
    if ((match = pathname.match(/^\/api\/shifts\/(\d{1,9})$/))) return json(await shiftDetail(env, Number(match[1])), { maxAge: 5 });
    if ((match = pathname.match(/^\/api\/shifts\/(\d{1,9})\/shot\/(before|after)\.png$/))) {
      const bytes = await readShot(env, Number(match[1]), match[2] as string);
      if (!bytes) throw new HttpError(404, 'No such image.');
      return png(bytes, 3600);
    }
    if ((match = pathname.match(/^\/api\/shifts\/(\d{1,9})\/card\.png$/))) {
      const shift = await getShift(env, Number(match[1]));
      if (!shift) throw new HttpError(404, 'No such shift.');
      return png(await shipCard(shift), shift.status === 'live' || shift.status === 'gate' ? 30 : 3600);
    }
    if ((match = pathname.match(/^\/api\/proposals\/(\d{1,9})\/card\.png$/))) {
      const proposal = await getProposal(env, Number(match[1]));
      // A card is a picture of the words, so a task that didn't pass screening never gets one.
      if (!proposal || proposal.status === 'rejected' || proposal.status === 'screening') throw new HttpError(404, 'No such card.');
      return png(await taskCard(proposal.id, proposal.text, proposal.votes), 300);
    }
    if ((match = pathname.match(/^\/api\/bosses\/([1-9A-HJ-NP-Za-km-z]{32,44})(\/card\.png)?$/))) {
      const boss = await bossProfile(env, match[1] as string);
      if (!boss) throw new HttpError(404, 'No such boss.');
      return match[2] ? png(await bossCard(boss.wallet, boss.rank, boss.shipped, boss.votes), 3600) : json(boss, { maxAge: 30 });
    }
    if ((match = pathname.match(/^\/api\/daily\/(\d{1,6})\/card\.png$/))) {
      const day = Number(match[1]);
      if (day < 1 || day > dayNumber(Date.now())) throw new HttpError(404, 'That day has not happened.');
      const scores = await leaderboard(env, day);
      return png(await dailyCard(day, scores[0]?.score ?? null), 300);
    }
    if (pathname === '/api/card.png') return png(await homeCard(), 86400);
    if ((match = pathname.match(/^\/api\/votes\/(\d{1,9})$/))) return json(await publicVotes(env, Number(match[1])), { maxAge: 5 });
    if (pathname === '/api/votes' || pathname === '/api/votes/') {
      const round = await advance(env);
      return json(await publicVotes(env, round.id), { maxAge: 5 });
    }
    if (pathname === '/.well-known/agent-intern.json') return manifest(env, origin);
    if (pathname === '/.well-known/security.txt') return securityTxt(origin);
    if (pathname === '/sitemap.xml') return sitemap(env, origin);
    if (pathname === '/robots.txt') return robots(origin);
    if (pathname === '/llms.txt') return llmsTxt(env, origin);
    if (pathname === '/feed.xml') return feed(env, origin);
    if (pathname === '/proof/sandbox-frame') {
      return htmlResponse(sandboxFrame(), 200, {
        'content-security-policy': `default-src 'none'; script-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts`,
      });
    }
    if (pathname === '/embed/status') {
      const o = await overview(env);
      return htmlResponse(embedStatus(shiftLine(o), o.version, origin), 200, {
        'content-security-policy': `default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors *`,
      });
    }
    if (pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
    const page = await htmlRoute(env, pathname, origin);
    if (!page) throw new HttpError(404, 'Not found.');
    return page instanceof Response ? page : pageResponse(env, page);
  });
}

async function postRoute(request: Request, env: Env, ctx: Ctx, url: URL, origin: string): Promise<Response> {
  const { pathname } = url;
  let match: RegExpMatchArray | null;

  // Machine routes. Each token opens exactly one door, and none of them live in the container.
  if (pathname === '/api/live/event') {
    await requireBearer(request, env.WATCHER_TOKEN);
    return json(await receiveLiveEvent(env, await readJson(request)));
  }
  if (pathname === '/api/gate/event') {
    await requireBearer(request, env.GATE_TOKEN);
    const result = await receiveGateEvent(env, await readJson(request));
    if (result.status === 'shipped' && result.shift?.worked_by === 'intern') {
      const { id, task_text: body, proposer } = result.shift;
      ctx.waitUntil(sendPush(env, `shipped:${id}`, { title: 'The intern shipped', body, url: `${origin}/shift/${id}` }, proposer ? { wallet: proposer, title: 'Your task shipped' } : undefined));
    }
    return json({ status: result.status });
  }
  if ((match = pathname.match(/^\/api\/gate\/shot\/(\d{1,9})\/(before|after)$/))) {
    await requireBearer(request, env.GATE_TOKEN);
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_SHOT_BYTES) throw new HttpError(413, 'That image is too big.');
    await storeShot(env, Number(match[1]), match[2] as string, new Uint8Array(await request.arrayBuffer()));
    return json({ stored: true });
  }
  if (pathname.startsWith('/api/shift/')) {
    await requireBearer(request, env.SHIFT_TOKEN);
    const body = await readJson<Record<string, unknown>>(request);
    if (pathname === '/api/shift/start') {
      const shift = await startShift(env, body);
      if (shift.worked_by === 'intern') {
        ctx.waitUntil(sendPush(env, `started:${shift.id}`, { title: 'The intern is on shift', body: shift.task_text, url: `${origin}/live` }));
      }
      return json({ shift });
    }
    if (pathname === '/api/shift/team') return json({ shift: await startTeamChange(env, body) });
    if (pathname === '/api/shift/finish') return json({ shift: await finishShift(env, body) });
    if (pathname === '/api/shift/reopen') return json({ shift: await reopenShift(env, body) });
    if (pathname === '/api/shift/pause') return json(await setPaused(env, body.reason));
    throw new HttpError(404, 'Not found.');
  }
  if (pathname === '/mcp') return mcp(env, request, origin);

  // Everything else is a person in a browser on our own pages.
  requireSameOrigin(request, env);

  if (pathname === '/api/auth/nonce') {
    const body = await readJson<{ wallet?: unknown }>(request);
    return json(await requestNonce(env, request, body.wallet));
  }
  if (pathname === '/api/auth/sign-in') {
    const body = await readJson<SignedRequest>(request);
    await rateLimit(env, 'sign-in', clientIp(request), 20, MINUTE);
    await verifySigned(env, body, { action: 'sign-in' });
    const balance = await readBalance(env, body.wallet);
    const cookie = await createSession(env, body.wallet);
    if (meetsThreshold(balance)) await recordFoundingBoss(env, body.wallet);
    return json(
      { wallet: body.wallet, balance: balance.display, slot: balance.slot, pass: meetsThreshold(balance), threshold: threshold() },
      { headers: { 'set-cookie': cookie } },
    );
  }
  if (pathname === '/api/auth/sign-out') {
    await rateLimit(env, 'sign-out', clientIp(request), 30, MINUTE);
    await dropSession(env, request);
    return json({ ok: true }, { headers: { 'set-cookie': CLEAR_COOKIE } });
  }
  if (pathname === '/api/proposals' || pathname === '/api/votes') {
    const result = pathname === '/api/votes'
      ? await vote(env, request, await readJson(request))
      : await propose(env, ctx, request, await readJson(request));
    const round = await advance(env);
    await purge(request, ['/', '/board', '/hr', '/break', '/api/board', '/api/state', '/api/votes', `/api/votes/${round.id}`]);
    return json(result);
  }
  if (pathname === '/api/ratings') return json(await rateShift(env, request, await readJson(request)));
  if (pathname === '/api/scores') {
    const result = await submitScore(env, request, await readJson(request));
    await purge(request, ['/play', `/play/${dayNumber(Date.now())}`, '/api/leaderboard', `/api/leaderboard?day=${dayNumber(Date.now())}`]);
    return json(result);
  }
  if (pathname === '/api/practice/check') return json(await practiceCheck(env, request, await readJson(request)));
  if (pathname === '/api/push/subscribe') return json(await subscribePush(env, request, await readJson(request)));
  if (pathname === '/api/push/unsubscribe') {
    await rateLimit(env, 'push-off', clientIp(request), 10, 10 * MINUTE);
    return json(await unsubscribePush(env, await readJson(request)));
  }
  if (pathname === '/api/test/balance' && testMode()) {
    const body = await readJson<{ balance?: unknown }>(request);
    return json(await setTestBalance(env, request, body.balance));
  }
  throw new HttpError(404, 'Not found.');
}

function notFoundPage(env: Env, pathname: string): Response {
  const page: Page = raw404(pathname);
  return htmlResponse(renderPage(env, page, { label: 'off shift', on: false, paused: null }), 404, {
    'content-security-policy': csp(gameAddress(env)),
    'x-frame-options': 'DENY',
  });
}

export async function handle(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  // Signatures name one domain, so the old address sends people to the real one.
  if (url.hostname.endsWith('.pages.dev') && !env.SITE_ORIGIN) {
    return Response.redirect(`${SITE.siteOrigin}${url.pathname}${url.search}`, 301);
  }
  const wantsPage = !url.pathname.startsWith('/api/') && url.pathname !== '/mcp' && request.method === 'GET';
  try {
    const origin = siteOrigin(env);
    if (request.method === 'GET' || request.method === 'HEAD') return await getRoute(request, env, ctx, url, origin);
    if (request.method === 'POST') return await postRoute(request, env, ctx, url, origin);
    throw new HttpError(405, 'Method not allowed.');
  } catch (cause) {
    if (cause instanceof HttpError) {
      if (wantsPage && cause.status === 404) return notFoundPage(env, url.pathname);
      return json({ error: cause.message, code: cause.code }, { status: cause.status });
    }
    console.log('unhandled', cause instanceof Error ? cause.stack : String(cause));
    return json({ error: 'Something broke on our side.', code: 'server' }, { status: 500 });
  }
}

