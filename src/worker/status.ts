import { mint, SITE, testMode, threshold, siteOrigin } from './config';
import type { Env } from './env';
import { HttpError } from './http';
import { getShift, listShifts, openShift, queuedTasks, type ShiftRow } from './shifts';
import { getPause, getSetting } from './settings';
import { advance, type Round } from './rounds';
import { listProposals } from './board';
import { shortWallet } from './card';

export function publicConfig(env: Env): Record<string, unknown> {
  const base: Record<string, unknown> = {
    mode: testMode() ? 'test' : 'live',
    threshold: threshold(),
    siteOrigin: siteOrigin(env),
    gameOrigin: SITE.gameOrigin,
    repos: SITE.repos,
    closesUtc: SITE.rounds.closesUtc,
  };
  if (!testMode()) base.mint = mint();
  return base;
}

function shiftSummary(shift: ShiftRow): Record<string, unknown> {
  return {
    id: shift.id,
    status: shift.status,
    state: shift.state,
    attempt: shift.attempt,
    startedAt: shift.started_at,
    endedAt: shift.ended_at,
    task: shift.task_text,
    kind: shift.task_kind,
    proposer: shift.proposer ? shortWallet(shift.proposer) : null,
    votes: shift.votes,
    round: shift.round_id,
    version: shift.version,
    commit: shift.commit_sha,
    summary: shift.summary,
    note: shift.note,
    prUrl: shift.pr_url,
    diffUrl: shift.diff_url,
    runUrl: shift.run_url,
    handEdited: shift.hand_edited === 1,
    rehearsal: shift.rehearsal === 1,
    filesChanged: shift.files_changed,
    linesAdded: shift.lines_added,
    linesRemoved: shift.lines_removed,
  };
}

function roundSummary(round: Round): Record<string, unknown> {
  return { id: round.id, status: round.status, opensAt: round.opens_at, closesAt: round.closes_at };
}

async function rpcHealth(env: Env): Promise<Record<string, unknown>> {
  if (testMode()) return { state: 'test-mode' };
  const [ok, fail] = await Promise.all([getSetting(env, 'rpc_last_ok'), getSetting(env, 'rpc_last_fail')]);
  const lastOk = Number(ok ?? 0);
  const lastFail = Number(fail ?? 0);
  return { state: lastFail > lastOk ? 'down' : lastOk ? 'ok' : 'unknown', lastOk: lastOk || null, lastFail: lastFail || null };
}

export async function homeState(env: Env): Promise<Record<string, unknown>> {
  const round = await advance(env);
  const [pause, shift, proposals, queue, rpc, lastShipped] = await Promise.all([
    getPause(env),
    openShift(env),
    listProposals(env, round.id),
    queuedTasks(env),
    rpcHealth(env),
    env.DB.prepare(`SELECT version FROM shifts WHERE status = 'shipped' ORDER BY id DESC LIMIT 1`).first<{ version: string }>(),
  ]);
  return {
    config: publicConfig(env),
    pause,
    round: roundSummary(round),
    shift: shift ? shiftSummary(shift) : null,
    queue: queue.map(maskProposer),
    top: proposals.filter((p) => p.status === 'open').slice(0, 5).map(publicProposal),
    version: lastShipped?.version ?? null,
    rpc,
  };
}

export function publicProposal(p: { id: number; wallet: string; text: string; status: string; reason: string | null; rejected_by: string | null; created_at: number; votes: number }): Record<string, unknown> {
  return {
    id: p.id,
    wallet: p.wallet,
    by: shortWallet(p.wallet),
    text: p.text,
    status: p.status,
    reason: p.reason,
    rejectedBy: p.rejected_by,
    at: p.created_at,
    votes: p.votes,
  };
}

function maskProposer(task: unknown): unknown {
  const t = task as { proposer: string | null };
  return { ...t, proposer: t.proposer ? shortWallet(t.proposer) : null };
}

export async function board(env: Env): Promise<Record<string, unknown>> {
  const round = await advance(env);
  const [proposals, pause, queue] = await Promise.all([listProposals(env, round.id), getPause(env), queuedTasks(env)]);
  return { config: publicConfig(env), round: roundSummary(round), proposals: proposals.map(publicProposal), pause, queue: queue.map(maskProposer) };
}

export async function liveFeed(env: Env, after: number): Promise<Record<string, unknown>> {
  const [shift, queue, pause] = await Promise.all([openShift(env), queuedTasks(env), getPause(env)]);
  const latest = shift ?? (await env.DB.prepare(`SELECT id FROM shifts ORDER BY id DESC LIMIT 1`).first<{ id: number }>());
  const shiftId = latest?.id ?? 0;
  const events = shiftId
    ? (await env.DB.prepare(
        'SELECT id, at, kind, data FROM shift_events WHERE shift_id = ? AND id > ? ORDER BY id DESC LIMIT 60',
      ).bind(shiftId, after).all<{ id: number; at: number; kind: string; data: string }>()).results.reverse()
    : [];
  const last = shift ? null : shiftId ? await getShift(env, shiftId) : null;
  return {
    onShift: Boolean(shift),
    shift: shift ? shiftSummary(shift) : null,
    last: last ? shiftSummary(last) : null,
    events: events.map((e) => ({ id: e.id, at: e.at, kind: e.kind, data: JSON.parse(e.data) as unknown })),
    queue: queue.map(maskProposer),
    pause,
  };
}

export async function shiftHistory(env: Env): Promise<Record<string, unknown>> {
  const shifts = await listShifts(env, 200);
  return { shifts: shifts.map(shiftSummary) };
}

export async function shiftDetail(env: Env, id: number): Promise<Record<string, unknown>> {
  const shift = await getShift(env, id);
  if (!shift) throw new HttpError(404, 'No such shift.', 'no-shift');
  const [gate, events, media, tally] = await Promise.all([
    env.DB.prepare('SELECT attempt, stage, status, detail, run_url AS runUrl, at FROM gate_results WHERE shift_id = ? ORDER BY id').bind(id).all(),
    env.DB.prepare('SELECT id, at, kind, data FROM shift_events WHERE shift_id = ? ORDER BY id DESC LIMIT 200')
      .bind(id).all<{ id: number; at: number; kind: string; data: string }>(),
    env.DB.prepare('SELECT kind FROM shift_media WHERE shift_id = ?').bind(id).all<{ kind: string }>(),
    shift.round_id
      ? env.DB.prepare('SELECT COUNT(*) AS total, SUM(counted = 1) AS counted FROM votes WHERE round_id = ?').bind(shift.round_id).first<{ total: number; counted: number | null }>()
      : Promise.resolve(null),
  ]);
  return {
    shift: shiftSummary(shift),
    gate: gate.results,
    events: events.results.reverse().map((e) => ({ id: e.id, at: e.at, kind: e.kind, data: JSON.parse(e.data) as unknown })),
    shots: media.results.map((m) => m.kind),
    votes: tally ? { total: tally.total, counted: tally.counted ?? 0 } : null,
    repos: SITE.repos,
  };
}

export async function changelog(env: Env): Promise<Record<string, unknown>> {
  const rows = await env.DB.prepare(
    `SELECT s.id, s.version, s.commit_sha AS commitSha, s.ended_at AS at, s.summary, s.hand_edited AS handEdited,
       s.rehearsal, t.text AS task, t.kind, t.proposer
     FROM shifts s JOIN tasks t ON t.id = s.task_id
     WHERE s.status IN ('shipped', 'rolled-back') ORDER BY s.id DESC LIMIT 200`,
  ).all<{ proposer: string | null }>();
  return { entries: rows.results.map(maskProposer), repos: SITE.repos };
}

async function gameHealth(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${SITE.gameOrigin}/health.json`, { signal: AbortSignal.timeout(3000), cf: { cacheTtl: 30 } } as RequestInit);
    if (!response.ok) return { ok: false, detail: `status ${response.status}` };
    const body = (await response.json()) as { version?: unknown; task?: unknown };
    return { ok: true, version: typeof body.version === 'string' ? body.version : null };
  } catch {
    return { ok: false, detail: 'unreachable' };
  }
}

export async function status(env: Env): Promise<Record<string, unknown>> {
  const round = await advance(env);
  const [pause, rpc, queue, game, last, gate, counts] = await Promise.all([
    getPause(env),
    rpcHealth(env),
    queuedTasks(env),
    gameHealth(),
    listShifts(env, 1),
    env.DB.prepare('SELECT shift_id AS shift, attempt, stage, status, detail, at FROM gate_results ORDER BY id DESC LIMIT 12').all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(status = 'shipped') AS shipped, SUM(status = 'refused') AS refused,
         SUM(status = 'failed') AS failed, SUM(status = 'rolled-back') AS rolledBack FROM shifts`,
    ).first(),
  ]);
  return {
    config: publicConfig(env),
    pause,
    rpc,
    round: roundSummary(round),
    queueLength: queue.length,
    game,
    lastShift: last[0] ? shiftSummary(last[0]) : null,
    gate: gate.results,
    counts,
    checkedAt: Date.now(),
  };
}

