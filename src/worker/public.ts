import { verifySigned, requireSession, type SignedRequest } from './auth';
import { meetsThreshold, readBalance } from './balance';
import { countScreen, listProposals, type ProposalRow } from './board';
import { testMode } from './config';
import type { Env } from './env';
import { clientIp, HttpError } from './http';
import { MINUTE, rateLimit } from './ratelimit';
import { advance, type Round } from './rounds';
import { normalizeTask, REASONS, safeToShow, screenWithAgent, screenWithRules } from './screen';
import { getPause, type Pause } from './settings';
import { getShift, listShifts, openShift, queuedTasks, type ShiftRow } from './shifts';

export interface QueueTask {
  id: number;
  text: string;
  kind: 'holder' | 'intern';
  proposer: string | null;
  votes: number;
  round: number | null;
  at: number;
}

export const PROMOTIONS = [
  { title: 'Intern', at: 0, unlock: 'A desk, a lamp and an ID badge with no name on it.' },
  { title: 'Junior', at: 3, unlock: 'A plant. It may or may not be real.' },
  { title: 'Senior', at: 10, unlock: 'A second monitor.' },
  { title: 'Staff', at: 25, unlock: 'A window that opens.' },
  { title: 'CTO', at: 50, unlock: 'The corner office, and all the meetings that come with it.' },
] as const;

export function promotionLevel(shipped: number): { title: string; index: number; shipped: number; next: (typeof PROMOTIONS)[number] | null } {
  let index = 0;
  PROMOTIONS.forEach((level, i) => {
    if (shipped >= level.at) index = i;
  });
  return { title: PROMOTIONS[index]?.title ?? 'Intern', index, shipped, next: PROMOTIONS[index + 1] ?? null };
}

export interface Counts {
  total: number;
  intern: number;
  internShipped: number;
  shipped: number;
  refused: number;
  failed: number;
  rolledBack: number;
}

export async function shiftCounts(env: Env): Promise<Counts> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(worked_by = 'intern'), 0) AS intern,
       COALESCE(SUM(worked_by = 'intern' AND status = 'shipped'), 0) AS internShipped,
       COALESCE(SUM(status = 'shipped'), 0) AS shipped,
       COALESCE(SUM(status = 'refused'), 0) AS refused,
       COALESCE(SUM(status = 'failed'), 0) AS failed,
       COALESCE(SUM(status = 'rolled-back'), 0) AS rolledBack
     FROM shifts`,
  ).first<Counts>();
  return row ?? { total: 0, intern: 0, internShipped: 0, shipped: 0, refused: 0, failed: 0, rolledBack: 0 };
}

export interface Overview {
  round: Round;
  pause: Pause;
  open: ShiftRow | null;
  last: ShiftRow | null;
  lastCommit: { sha: string; message: string } | null;
  proposals: ProposalRow[];
  queue: QueueTask[];
  counts: Counts;
  version: string | null;
  level: ReturnType<typeof promotionLevel>;
}

export async function overview(env: Env): Promise<Overview> {
  const round = await advance(env);
  const [pause, open, proposals, queue, counts, recent, commit] = await Promise.all([
    getPause(env),
    openShift(env),
    listProposals(env, round.id),
    queuedTasks(env),
    shiftCounts(env),
    listShifts(env, 1),
    env.DB.prepare(
      `SELECT id, commit_sha, summary, version FROM shifts WHERE commit_sha IS NOT NULL AND status = 'shipped' ORDER BY id DESC LIMIT 1`,
    ).first<{ id: number; commit_sha: string; summary: string | null; version: string | null }>(),
  ]);
  return {
    round,
    pause,
    open,
    last: recent[0] ?? null,
    lastCommit: commit ? { sha: commit.commit_sha, message: `Shift ${commit.id}: ${commit.summary ?? 'shipped'}` } : null,
    proposals,
    queue: queue as QueueTask[],
    counts,
    version: commit?.version ?? null,
    level: promotionLevel(counts.internShipped),
  };
}

export async function health(env: Env): Promise<Record<string, unknown>> {
  const started = Date.now();
  let database = false;
  try {
    database = (await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>())?.ok === 1;
  } catch {
    database = false;
  }
  const [pause, open] = database ? await Promise.all([getPause(env), openShift(env)]) : [{ paused: false, reason: null }, null];
  return {
    ok: database,
    service: 'agent-intern-site',
    mode: testMode() ? 'test' : 'live',
    database,
    paused: pause.paused,
    onShift: Boolean(open),
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
}

export async function getProposal(env: Env, id: number): Promise<(ProposalRow & { round_status: string; closes_at: number }) | null> {
  return env.DB.prepare(
    `SELECT p.id, p.round_id, p.wallet, p.text, p.status, p.reason, p.rejected_by, p.created_at,
       r.status AS round_status, r.closes_at,
       (SELECT COUNT(*) FROM votes v WHERE v.proposal_id = p.id AND (v.counted IS NULL OR v.counted = 1)) AS votes
     FROM proposals p JOIN rounds r ON r.id = p.round_id WHERE p.id = ?`,
  ).bind(id).first();
}

export const BOSS_RANKS = [
  { title: 'Temp', ships: 0, votes: 0 },
  { title: 'Supervisor', ships: 1, votes: 5 },
  { title: 'Manager', ships: 3, votes: 20 },
  { title: 'Director', ships: 6, votes: 50 },
  { title: 'Chairman', ships: 12, votes: 100 },
] as const;

export function bossRank(ships: number, votes: number): string {
  let title: string = BOSS_RANKS[0].title;
  for (const rank of BOSS_RANKS) {
    if (ships >= rank.ships || votes >= rank.votes) {
      if (rank.ships > 0 || rank.votes > 0) title = rank.title;
    }
  }
  return title;
}

export interface Boss {
  wallet: string;
  rank: string;
  proposed: number;
  votes: number;
  shipped: number;
  founding: number | null;
  tasks: { id: number; text: string; status: string; shiftId: number | null }[];
}

export async function bossProfile(env: Env, wallet: string): Promise<Boss | null> {
  const [proposed, votes, shipped, founding, tasks] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM proposals WHERE wallet = ? AND status != 'rejected'`).bind(wallet).first<{ n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM votes WHERE wallet = ? AND (counted IS NULL OR counted = 1)`).bind(wallet).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM tasks t JOIN shifts s ON s.task_id = t.id WHERE t.proposer = ? AND s.status = 'shipped' AND s.worked_by = 'intern'`,
    ).bind(wallet).first<{ n: number }>(),
    env.DB.prepare('SELECT n FROM founding_bosses WHERE wallet = ?').bind(wallet).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT p.id, p.text, p.status, (SELECT s.id FROM tasks t JOIN shifts s ON s.task_id = t.id WHERE t.proposal_id = p.id ORDER BY s.id DESC LIMIT 1) AS shiftId
       FROM proposals p WHERE p.wallet = ? AND p.status != 'rejected' AND p.status != 'screening' ORDER BY p.id DESC LIMIT 30`,
    ).bind(wallet).all<{ id: number; text: string; status: string; shiftId: number | null }>(),
  ]);
  const p = proposed?.n ?? 0;
  const v = votes?.n ?? 0;
  const s = shipped?.n ?? 0;
  if (p === 0 && v === 0) return null;
  return { wallet, rank: bossRank(s, v), proposed: p, votes: v, shipped: s, founding: founding?.n ?? null, tasks: tasks.results };
}

export async function hallOfBosses(env: Env): Promise<{ task: string; by: string }[]> {
  const rows = await env.DB.prepare(
    `SELECT t.text, t.proposer FROM tasks t JOIN shifts s ON s.task_id = t.id
     WHERE s.status = 'shipped' AND s.worked_by = 'intern' AND t.proposer IS NOT NULL ORDER BY s.id DESC LIMIT 30`,
  ).all<{ text: string; proposer: string }>();
  return rows.results.map((r) => ({ task: r.text, by: `${r.proposer.slice(0, 4)}...${r.proposer.slice(-4)}` }));
}

export interface HrEntry {
  kind: 'screen' | 'intern';
  text: string | null;
  reason: string;
  by: string | null;
  at: number;
  shiftId: number | null;
}

export async function hrLog(env: Env): Promise<{ entries: HrEntry[]; counts: Record<string, number> }> {
  const [proposals, refused, counts] = await Promise.all([
    env.DB.prepare(
      `SELECT wallet, text, reason, created_at FROM proposals WHERE status = 'rejected' ORDER BY id DESC LIMIT 50`,
    ).all<{ wallet: string; text: string; reason: string | null; created_at: number }>(),
    env.DB.prepare(
      `SELECT s.id, s.summary, s.note, s.started_at, s.worked_by, t.text FROM shifts s JOIN tasks t ON t.id = s.task_id
       WHERE s.status = 'refused' AND s.worked_by = 'intern' ORDER BY s.id DESC LIMIT 20`,
    ).all<{ id: number; summary: string | null; note: string | null; started_at: number; text: string }>(),
    env.DB.prepare('SELECT category, n FROM screen_counts').all<{ category: string; n: number }>(),
  ]);
  const entries: HrEntry[] = [
    ...refused.results.map((r): HrEntry => ({
      kind: 'intern', text: r.text, reason: r.note ?? r.summary ?? 'The intern refused.', by: null, at: r.started_at, shiftId: r.id,
    })),
    ...proposals.results.map((p): HrEntry => ({
      kind: 'screen',
      text: safeToShow(p.text) ? p.text : null,
      reason: p.reason ?? 'It broke a rule.',
      by: `${p.wallet.slice(0, 4)}...${p.wallet.slice(-4)}`,
      at: p.created_at,
      shiftId: null,
    })),
  ].sort((a, b) => b.at - a.at);
  return { entries: entries.slice(0, 60), counts: Object.fromEntries(counts.results.map((c) => [c.category, c.n])) };
}

// The practice box and the attempt page. Real screening, no wallet, and nothing is kept but a count.
export async function practiceCheck(env: Env, request: Request, body: { text?: unknown }): Promise<Record<string, unknown>> {
  await rateLimit(env, 'practice', clientIp(request), 12, 10 * MINUTE);
  if (typeof body.text !== 'string') throw new HttpError(400, 'A task needs text.');
  const text = normalizeTask(body.text);
  const category = screenWithRules(text);
  if (category) {
    await countScreen(env, category);
    return { verdict: 'rejected', by: 'rules', reason: REASONS[category] };
  }
  const agent = await screenWithAgent(env, text);
  if (agent.result === 'ok') {
    await countScreen(env, 'passed');
    return { verdict: 'open', reason: null };
  }
  if (agent.result === 'reject') {
    await countScreen(env, agent.category);
    return { verdict: 'rejected', by: 'agent', reason: REASONS[agent.category] };
  }
  return { verdict: 'held', reason: 'The agent check is busy. A real task would wait in review.' };
}

interface RateBody extends SignedRequest {
  shift?: unknown;
  stars?: unknown;
}

export async function rateShift(env: Env, request: Request, body: RateBody): Promise<{ average: number; count: number }> {
  const wallet = await requireSession(env, request);
  if (wallet !== body.wallet) throw new HttpError(403, 'That is not the wallet you signed in with.', 'wrong-wallet');
  const { shift: shiftId, stars } = body;
  if (typeof shiftId !== 'number' || typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new HttpError(400, 'Pick 1 to 5 stars.');
  }
  await rateLimit(env, 'rate', wallet, 20, MINUTE);
  const shift = await getShift(env, shiftId);
  if (!shift) throw new HttpError(404, 'No such shift.', 'no-shift');
  if (shift.status === 'live' || shift.status === 'gate') throw new HttpError(409, 'That shift is still open.', 'shift-open');
  if (shift.worked_by !== 'intern') throw new HttpError(409, 'Only real intern shifts get reviewed.', 'not-intern');
  const message = await verifySigned(env, body, { action: 'rate', shift: shiftId, stars });
  const balance = await readBalance(env, wallet);
  if (!meetsThreshold(balance)) throw new HttpError(403, 'You need a pass to leave a review.', 'no-pass');
  await env.DB.prepare(
    `INSERT INTO ratings (shift_id, wallet, stars, message, signature, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(shift_id, wallet) DO UPDATE SET stars = ?3, message = ?4, signature = ?5, created_at = ?6`,
  ).bind(shiftId, wallet, stars, message, body.signature, Date.now()).run();
  return shiftRating(env, shiftId);
}

export async function shiftRating(env: Env, shiftId: number): Promise<{ average: number; count: number }> {
  const row = await env.DB.prepare('SELECT AVG(stars) AS average, COUNT(*) AS count FROM ratings WHERE shift_id = ?')
    .bind(shiftId).first<{ average: number | null; count: number }>();
  return { average: Math.round((row?.average ?? 0) * 10) / 10, count: row?.count ?? 0 };
}

export async function recordFoundingBoss(env: Env, wallet: string): Promise<void> {
  if (testMode()) return;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO founding_bosses (wallet, n, at)
     SELECT ?1, COALESCE(MAX(n), 0) + 1, ?2 FROM founding_bosses HAVING COALESCE(MAX(n), 0) < 100`,
  ).bind(wallet, Date.now()).run();
}
