import { BACKLOG, SITE } from './config';
import { meetsThreshold, readBalance } from './balance';
import type { Env } from './env';
import { HttpError } from './http';
import { countScreen } from './board';
import { REASONS, screenWithAgent } from './screen';
import { getPause } from './settings';

export interface Round {
  id: number;
  opens_at: number;
  closes_at: number;
  status: 'open' | 'closing' | 'closed';
  winner_proposal_id: number | null;
  closed_at: number | null;
}

// RPC calls per request stay under the Workers subrequest limit. A big round closes over several requests.
const CLOSE_BATCH = 40;
const SCREEN_RETRIES_PER_REQUEST = 2;

export function nextCloseAfter(from: number, closesUtc: readonly string[] = SITE.rounds.closesUtc): number {
  const day = new Date(from);
  let best = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset <= 1; offset++) {
    for (const close of closesUtc) {
      const [hour, minute] = close.split(':').map(Number);
      const at = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + offset, hour, minute);
      if (at > from && at < best) best = at;
    }
  }
  return best;
}

export async function latestRound(env: Env): Promise<Round | null> {
  return env.DB.prepare('SELECT * FROM rounds ORDER BY id DESC LIMIT 1').first<Round>();
}

export async function getRound(env: Env, id: number): Promise<Round | null> {
  return env.DB.prepare('SELECT * FROM rounds WHERE id = ?').bind(id).first<Round>();
}

async function openRound(env: Env, opensAt: number): Promise<void> {
  await env.DB.prepare('INSERT INTO rounds (opens_at, closes_at) VALUES (?, ?)')
    .bind(opensAt, nextCloseAfter(opensAt)).run();
}

// Backlog items are used once. If it ever runs out the round simply queues nothing.
async function queueInternChoice(env: Env, round: Round): Promise<void> {
  const used = await env.DB.prepare('SELECT backlog_id FROM tasks WHERE backlog_id IS NOT NULL').all<{ backlog_id: string }>();
  const taken = new Set(used.results.map((r) => r.backlog_id));
  const item = BACKLOG.find((b) => !taken.has(b.id));
  if (!item) return;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tasks (round_id, text, kind, backlog_id, created_at) VALUES (?, ?, 'intern', ?, ?)`,
  ).bind(round.id, item.text, item.id, Date.now()).run();
}

// A wallet below the line at close doesn't count, however it voted earlier. An RPC failure leaves
// the round closing, so it finishes later on real numbers and nothing is granted on a guess.
async function recheckBalances(env: Env, round: Round): Promise<boolean> {
  const pending = await env.DB.prepare(
    'SELECT wallet FROM votes WHERE round_id = ? AND close_checked_at IS NULL LIMIT ?',
  ).bind(round.id, CLOSE_BATCH).all<{ wallet: string }>();

  for (const { wallet } of pending.results) {
    const balance = await readBalance(env, wallet);
    await env.DB.prepare(
      `UPDATE votes SET close_balance = ?, close_slot = ?, close_checked_at = ?, counted = ?
       WHERE round_id = ? AND wallet = ?`,
    ).bind(balance.display, balance.slot, Date.now(), meetsThreshold(balance) ? 1 : 0, round.id, wallet).run();
  }
  return pending.results.length < CLOSE_BATCH;
}

interface Tally {
  id: number;
  text: string;
  wallet: string;
  votes: number;
}

// Most counted votes wins. A tie goes to the earliest proposal, which is the lowest id.
export async function tally(env: Env, roundId: number): Promise<Tally | null> {
  return env.DB.prepare(
    `SELECT p.id, p.text, p.wallet, COUNT(v.wallet) AS votes
     FROM proposals p JOIN votes v ON v.proposal_id = p.id AND v.counted = 1
     WHERE p.round_id = ? AND p.status = 'open'
     GROUP BY p.id
     ORDER BY votes DESC, p.created_at ASC, p.id ASC
     LIMIT 1`,
  ).bind(roundId).first<Tally>();
}

async function finishClose(env: Env, round: Round): Promise<void> {
  const now = Date.now();
  const winner = await tally(env, round.id);
  if (winner) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO tasks (round_id, proposal_id, text, kind, proposer, votes, created_at)
         VALUES (?, ?, ?, 'holder', ?, ?, ?)`,
      ).bind(round.id, winner.id, winner.text, winner.wallet, winner.votes, now),
      env.DB.prepare(`UPDATE proposals SET status = 'won' WHERE id = ?`).bind(winner.id),
      env.DB.prepare(`UPDATE proposals SET status = 'lost' WHERE round_id = ? AND status = 'open'`).bind(round.id),
      env.DB.prepare(`UPDATE proposals SET status = 'rejected', reason = ?, rejected_by = 'rules'
                      WHERE round_id = ? AND status = 'screening'`).bind('The round closed before it could be checked.', round.id),
    ]);
  } else {
    await queueInternChoice(env, round);
    await env.DB.batch([
      env.DB.prepare(`UPDATE proposals SET status = 'lost' WHERE round_id = ? AND status = 'open'`).bind(round.id),
      env.DB.prepare(`UPDATE proposals SET status = 'rejected', reason = ?, rejected_by = 'rules'
                      WHERE round_id = ? AND status = 'screening'`).bind('The round closed before it could be checked.', round.id),
    ]);
  }
  const closed = await env.DB.prepare(
    `UPDATE rounds SET status = 'closed', closed_at = ?, winner_proposal_id = ? WHERE id = ? AND status = 'closing'`,
  ).bind(now, winner?.id ?? null, round.id).run();
  if (closed.meta.changes === 1) await openRound(env, Math.max(now, round.closes_at));
}

async function retryHeldScreening(env: Env, round: Round): Promise<void> {
  const held = await env.DB.prepare(
    `SELECT id, text FROM proposals WHERE round_id = ? AND status = 'screening' ORDER BY id LIMIT ?`,
  ).bind(round.id, SCREEN_RETRIES_PER_REQUEST).all<{ id: number; text: string }>();
  for (const proposal of held.results) await applyAgentCheck(env, proposal.id, proposal.text);
}

export async function applyAgentCheck(env: Env, id: number, text: string): Promise<void> {
  const verdict = await screenWithAgent(env, text);
  if (verdict.result === 'ok') {
    await env.DB.prepare(`UPDATE proposals SET status = 'open' WHERE id = ? AND status = 'screening'`).bind(id).run();
  } else if (verdict.result === 'reject') {
    await env.DB.prepare(
      `UPDATE proposals SET status = 'rejected', reason = ?, rejected_by = 'agent' WHERE id = ? AND status = 'screening'`,
    ).bind(REASONS[verdict.category], id).run();
    await countScreen(env, verdict.category);
  }
}

// Rounds have no scheduler. Whichever request first arrives after the close time does the close,
// and every step here is safe to repeat or race.
export async function advance(env: Env): Promise<Round> {
  let round = await latestRound(env);
  if (!round) {
    await openRound(env, Date.now());
    round = await latestRound(env);
    if (!round) throw new HttpError(500, 'No round.');
    return round;
  }

  const { paused } = await getPause(env);
  if (round.status === 'open' && Date.now() >= round.closes_at && !paused) {
    await env.DB.prepare(`UPDATE rounds SET status = 'closing' WHERE id = ? AND status = 'open'`).bind(round.id).run();
    round.status = 'closing';
  }

  if (round.status === 'closing' && !paused) {
    try {
      if (await recheckBalances(env, round)) await finishClose(env, round);
    } catch (cause) {
      if (!(cause instanceof HttpError && cause.code === 'rpc-down')) throw cause;
    }
    return (await latestRound(env)) ?? round;
  }

  if (round.status === 'open') await retryHeldScreening(env, round);
  return round;
}
