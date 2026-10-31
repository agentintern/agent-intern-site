import { isWallet, issueNonce, requireSession, verifySigned, type SignedRequest } from './auth';
import { meetsThreshold, readBalance } from './balance';
import { MAX_TASK_LENGTH, testMode } from './config';
import type { Ctx, Env } from './env';
import { HttpError } from './http';
import { rateLimit } from './ratelimit';
import { advance, applyAgentCheck, getRound, type Round } from './rounds';
import { normalizeTask, REASONS, screenWithRules } from './screen';
import { getPause } from './settings';

const REJECTS_PER_ROUND = 5;

export async function requestNonce(env: Env, wallet: unknown): Promise<{ nonce: string; issuedAt: string }> {
  if (!isWallet(wallet)) throw new HttpError(400, "That isn't a wallet address.", 'bad-wallet');
  await rateLimit(env, 'nonce', wallet, 30, 60_000);
  return issueNonce(env, wallet);
}

export interface ProposalRow {
  id: number;
  round_id: number;
  wallet: string;
  text: string;
  status: string;
  reason: string | null;
  rejected_by: string | null;
  created_at: number;
  votes: number;
}

export async function listProposals(env: Env, roundId: number): Promise<ProposalRow[]> {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.round_id, p.wallet, p.text, p.status, p.reason, p.rejected_by, p.created_at,
       (SELECT COUNT(*) FROM votes v WHERE v.proposal_id = p.id AND (v.counted IS NULL OR v.counted = 1)) AS votes
     FROM proposals p WHERE p.round_id = ?
     ORDER BY CASE p.status WHEN 'rejected' THEN 1 ELSE 0 END, votes DESC, p.created_at ASC, p.id ASC`,
  ).bind(roundId).all<ProposalRow>();
  return rows.results;
}

async function requireOpenRound(env: Env, roundId: unknown): Promise<Round> {
  const pause = await getPause(env);
  if (pause.paused) throw new HttpError(423, `Voting is paused: ${pause.reason}`, 'paused');
  const current = await advance(env);
  if (typeof roundId !== 'number' || current.id !== roundId || current.status !== 'open') {
    throw new HttpError(409, 'That round has closed. Refresh to see the new one.', 'round-closed');
  }
  if (Date.now() >= current.closes_at) throw new HttpError(409, 'That round has closed.', 'round-closed');
  return current;
}

async function requireHolder(env: Env, wallet: string): Promise<Awaited<ReturnType<typeof readBalance>>> {
  const balance = await readBalance(env, wallet);
  if (!meetsThreshold(balance)) {
    throw new HttpError(403, `You need a pass: this wallet holds ${balance.display}.`, 'no-pass');
  }
  return balance;
}

interface ProposeBody extends SignedRequest {
  round: number;
  text: string;
}

export async function propose(env: Env, ctx: Ctx, request: Request, body: ProposeBody): Promise<{ id: number; status: string; reason: string | null }> {
  const wallet = await requireSession(env, request);
  if (wallet !== body.wallet) throw new HttpError(403, 'That is not the wallet you signed in with.', 'wrong-wallet');
  if (typeof body.text !== 'string') throw new HttpError(400, 'A task needs text.');
  const round = await requireOpenRound(env, body.round);
  // The signature covers the text exactly as typed, so what's stored is what was signed.
  const message = await verifySigned(env, body, { action: 'propose', round: round.id, text: body.text });
  await requireHolder(env, wallet);
  await rateLimit(env, `propose:${round.id}`, wallet, REJECTS_PER_ROUND, 24 * 60 * 60 * 1000);

  const text = normalizeTask(body.text);
  const category = screenWithRules(text);
  const stored = text.slice(0, MAX_TASK_LENGTH);
  const now = Date.now();

  if (category) {
    const inserted = await env.DB.prepare(
      `INSERT INTO proposals (round_id, wallet, text, status, reason, rejected_by, message, signature, created_at)
       VALUES (?, ?, ?, 'rejected', ?, 'rules', ?, ?, ?) RETURNING id`,
    ).bind(round.id, wallet, stored, REASONS[category], message, body.signature, now).first<{ id: number }>();
    return { id: inserted?.id ?? 0, status: 'rejected', reason: REASONS[category] };
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM proposals WHERE round_id = ? AND wallet = ? AND status != 'rejected'`,
  ).bind(round.id, wallet).first();
  if (existing) throw new HttpError(409, 'You already have a task in this round.', 'one-per-round');

  const inserted = await env.DB.prepare(
    `INSERT INTO proposals (round_id, wallet, text, status, message, signature, created_at)
     VALUES (?, ?, ?, 'screening', ?, ?, ?) RETURNING id`,
  ).bind(round.id, wallet, stored, message, body.signature, now).first<{ id: number }>();
  const id = inserted?.id;
  if (!id) throw new HttpError(500, 'That did not save.');

  await applyAgentCheck(env, id, stored);
  const after = await env.DB.prepare('SELECT status, reason FROM proposals WHERE id = ?')
    .bind(id).first<{ status: string; reason: string | null }>();
  return { id, status: after?.status ?? 'screening', reason: after?.reason ?? null };
}

interface VoteBody extends SignedRequest {
  round: number;
  proposal: number;
}

export async function vote(env: Env, request: Request, body: VoteBody): Promise<{ proposal: number; balance: string; slot: number }> {
  const wallet = await requireSession(env, request);
  if (wallet !== body.wallet) throw new HttpError(403, 'That is not the wallet you signed in with.', 'wrong-wallet');
  const round = await requireOpenRound(env, body.round);
  if (typeof body.proposal !== 'number') throw new HttpError(400, 'A vote needs a proposal.');
  const target = await env.DB.prepare('SELECT status, round_id FROM proposals WHERE id = ?')
    .bind(body.proposal).first<{ status: string; round_id: number }>();
  if (!target || target.round_id !== round.id || target.status !== 'open') {
    throw new HttpError(404, "That task isn't open for votes.", 'bad-proposal');
  }
  const message = await verifySigned(env, body, { action: 'vote', round: round.id, proposal: body.proposal });
  const balance = await requireHolder(env, wallet);
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO votes (round_id, wallet, proposal_id, message, signature, slot, balance, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
     ON CONFLICT(round_id, wallet) DO UPDATE SET
       proposal_id = ?3, message = ?4, signature = ?5, slot = ?6, balance = ?7, updated_at = ?8`,
  ).bind(round.id, wallet, body.proposal, message, body.signature, balance.slot, balance.display, now).run();
  return { proposal: body.proposal, balance: balance.display, slot: balance.slot };
}

export async function publicVotes(env: Env, roundId: number): Promise<unknown> {
  const round = await getRound(env, roundId);
  if (!round) throw new HttpError(404, 'No such round.');
  const votes = await env.DB.prepare(
    `SELECT wallet, proposal_id AS proposal, signature, message, slot, balance, updated_at AS at,
       close_balance AS closeBalance, close_slot AS closeSlot, counted
     FROM votes WHERE round_id = ? ORDER BY updated_at DESC`,
  ).bind(roundId).all();
  return { round: round.id, status: round.status, closesAt: round.closes_at, votes: votes.results };
}

export async function setTestBalance(env: Env, request: Request, balance: unknown): Promise<{ balance: string }> {
  if (!testMode()) throw new HttpError(404, 'Not found.');
  const wallet = await requireSession(env, request);
  if (typeof balance !== 'number' || !Number.isInteger(balance) || balance < 0 || balance > 1e12) {
    throw new HttpError(400, 'Pick a whole number.');
  }
  await env.DB.prepare(
    `INSERT INTO test_balances (wallet, balance) VALUES (?1, ?2) ON CONFLICT(wallet) DO UPDATE SET balance = ?2`,
  ).bind(wallet, String(balance)).run();
  return { balance: String(balance) };
}
