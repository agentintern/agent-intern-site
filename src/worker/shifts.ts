import { MAX_ATTEMPTS } from './config';
import type { Env } from './env';
import { HttpError } from './http';
import { looksSecret } from './secrets';
import { advance } from './rounds';
import { getPause } from './settings';

export type LiveState = 'reading' | 'writing' | 'testing' | 'stuck' | 'gate' | 'shipped' | 'off-shift';

export interface ShiftRow {
  id: number;
  task_id: number;
  status: 'live' | 'gate' | 'shipped' | 'refused' | 'failed' | 'rolled-back';
  state: string;
  attempt: number;
  started_at: number;
  ended_at: number | null;
  summary: string | null;
  note: string | null;
  version: string | null;
  commit_sha: string | null;
  pr_url: string | null;
  diff_url: string | null;
  run_url: string | null;
  hand_edited: number;
  rehearsal: number;
  worked_by: string;
  files_changed: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  task_text: string;
  task_kind: 'holder' | 'intern';
  task_team: number;
  proposer: string | null;
  votes: number;
  round_id: number | null;
}

// One word for who did the work, used everywhere a shift appears.
export const WORK_LABELS: Record<string, { label: string; meaning: string }> = {
  intern: { label: 'INTERN', meaning: 'The intern did this work in a shift a person started.' },
  rehearsal: { label: 'REHEARSAL', meaning: 'A person ran this to test the pipeline. No model did the work.' },
  team: { label: 'TEAM CHANGE', meaning: 'The people running the project made this change, with Claude Code doing much of the writing. It went through the same gate, and it never counts as intern work.' },
  none: { label: 'NOT WORKED', meaning: 'The shift opened, but nobody did any work in it.' },
};

const SHIFT_SELECT = `
  SELECT s.*, t.text AS task_text, t.kind AS task_kind, t.team AS task_team, t.proposer, t.votes, t.round_id
  FROM shifts s JOIN tasks t ON t.id = s.task_id`;

export async function openShift(env: Env): Promise<ShiftRow | null> {
  return env.DB.prepare(`${SHIFT_SELECT} WHERE s.status IN ('live', 'gate') ORDER BY s.id DESC LIMIT 1`).first<ShiftRow>();
}

export async function getShift(env: Env, id: number): Promise<ShiftRow | null> {
  return env.DB.prepare(`${SHIFT_SELECT} WHERE s.id = ?`).bind(id).first<ShiftRow>();
}

export async function listShifts(env: Env, limit = 100): Promise<ShiftRow[]> {
  const rows = await env.DB.prepare(`${SHIFT_SELECT} ORDER BY s.id DESC LIMIT ?`).bind(limit).all<ShiftRow>();
  return rows.results;
}

export async function queuedTasks(env: Env): Promise<unknown[]> {
  const rows = await env.DB.prepare(
    `SELECT id, text, kind, proposer, votes, round_id AS round, created_at AS at FROM tasks WHERE status = 'queued' ORDER BY id LIMIT 50`,
  ).all();
  return rows.results;
}

export async function logEvent(env: Env, shiftId: number, kind: string, data: unknown): Promise<void> {
  await env.DB.prepare('INSERT INTO shift_events (shift_id, at, kind, data) VALUES (?, ?, ?, ?)')
    .bind(shiftId, Date.now(), kind, JSON.stringify(data)).run();
}

async function requireOpen(env: Env, id: unknown): Promise<ShiftRow> {
  const shift = typeof id === 'number' ? await getShift(env, id) : null;
  if (!shift) throw new HttpError(404, 'No such shift.', 'no-shift');
  if (shift.status !== 'live' && shift.status !== 'gate') throw new HttpError(409, 'That shift is over.', 'shift-over');
  return shift;
}

export async function startShift(env: Env, body: { taskId?: unknown; rehearsal?: unknown }): Promise<ShiftRow> {
  const pause = await getPause(env);
  if (pause.paused) throw new HttpError(423, `Shifts are paused: ${pause.reason}`, 'paused');
  await advance(env);
  if (await openShift(env)) throw new HttpError(409, 'A shift is already open.', 'shift-open');
  const next = await env.DB.prepare(`SELECT id FROM tasks WHERE status = 'queued' ORDER BY id LIMIT 1`).first<{ id: number }>();
  if (!next) throw new HttpError(404, 'The queue is empty.', 'queue-empty');
  // Tasks come off the queue in order. The confirmed id guards against the queue changing underneath.
  if (body.taskId !== next.id) throw new HttpError(409, 'The next task changed. Run it again.', 'task-changed');

  const inserted = await env.DB.prepare(
    `INSERT INTO shifts (task_id, started_at, rehearsal, worked_by) VALUES (?, ?, ?, ?) RETURNING id`,
  ).bind(next.id, Date.now(), body.rehearsal === true ? 1 : 0, body.rehearsal === true ? 'rehearsal' : 'intern').first<{ id: number }>();
  const id = inserted?.id;
  if (!id) throw new HttpError(500, 'That did not save.');
  await env.DB.prepare(`UPDATE tasks SET status = 'in-shift' WHERE id = ?`).bind(next.id).run();
  await logEvent(env, id, 'state', { state: 'reading' });
  const shift = await getShift(env, id);
  if (!shift) throw new HttpError(500, 'That did not save.');
  return shift;
}

// Work by the people who run the project, outside the queue. It goes through the same gate and is
// labeled TEAM CHANGE in public. It never counts toward the intern's Promotion Track.
export async function startTeamChange(env: Env, body: { text?: unknown }): Promise<ShiftRow> {
  await advance(env);
  if (await openShift(env)) throw new HttpError(409, 'A shift is already open.', 'shift-open');
  const text = cleanText(body.text, 120);
  if (!text) throw new HttpError(400, 'A team change needs a description.');
  const now = Date.now();
  const task = await env.DB.prepare(
    `INSERT INTO tasks (text, kind, team, status, created_at) VALUES (?, 'intern', 1, 'in-shift', ?) RETURNING id`,
  ).bind(text, now).first<{ id: number }>();
  const inserted = await env.DB.prepare(
    `INSERT INTO shifts (task_id, started_at, hand_edited, worked_by) VALUES (?, ?, 1, 'team') RETURNING id`,
  ).bind(task?.id, now).first<{ id: number }>();
  if (!inserted) throw new HttpError(500, 'That did not save.');
  await logEvent(env, inserted.id, 'state', { state: 'reading' });
  const shift = await getShift(env, inserted.id);
  if (!shift) throw new HttpError(500, 'That did not save.');
  return shift;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!text) return null;
  return looksSecret(text) ? '[removed: this looked like a secret]' : text;
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

interface FinishBody {
  shiftId?: unknown;
  status?: unknown;
  summary?: unknown;
  note?: unknown;
  handEdited?: unknown;
  filesChanged?: unknown;
  linesAdded?: unknown;
  linesRemoved?: unknown;
  prUrl?: unknown;
  diffUrl?: unknown;
}

const gitHubUrl = (value: unknown): string | null =>
  typeof value === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/[\w./#=?&-]+$/.test(value) ? value : null;

export async function finishShift(env: Env, body: FinishBody): Promise<ShiftRow> {
  const shift = await requireOpen(env, body.shiftId);
  const status = body.status;
  if (status !== 'done' && status !== 'refused' && status !== 'failed') {
    throw new HttpError(400, 'status has to be done, refused or failed.');
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE shifts SET summary = ?, note = ?, hand_edited = MAX(hand_edited, ?), files_changed = ?, lines_added = ?,
       lines_removed = ?, pr_url = COALESCE(?, pr_url), diff_url = COALESCE(?, diff_url) WHERE id = ?`,
  ).bind(
    cleanText(body.summary, 200), cleanText(body.note, 280), body.handEdited === true ? 1 : 0, count(body.filesChanged),
    count(body.linesAdded), count(body.linesRemoved), gitHubUrl(body.prUrl), gitHubUrl(body.diffUrl), shift.id,
  ).run();

  if (status === 'done') {
    await env.DB.prepare(`UPDATE shifts SET status = 'gate', state = 'gate' WHERE id = ?`).bind(shift.id).run();
    await logEvent(env, shift.id, 'state', { state: 'gate' });
  } else {
    await env.DB.batch([
      env.DB.prepare(`UPDATE shifts SET status = ?, state = ?, ended_at = ? WHERE id = ?`).bind(status, status, now, shift.id),
      env.DB.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).bind(status, shift.task_id),
    ]);
    await logEvent(env, shift.id, 'state', { state: status });
  }
  const after = await getShift(env, shift.id);
  if (!after) throw new HttpError(500, 'That did not save.');
  return after;
}

export async function reopenShift(env: Env, body: { shiftId?: unknown }): Promise<ShiftRow> {
  const shift = await requireOpen(env, body.shiftId);
  if (shift.status !== 'live' && shift.attempt >= MAX_ATTEMPTS) {
    throw new HttpError(409, 'This shift is out of tries.', 'out-of-tries');
  }
  await env.DB.prepare(`UPDATE shifts SET status = 'live', state = 'reading', attempt = attempt + 1 WHERE id = ?`).bind(shift.id).run();
  await logEvent(env, shift.id, 'state', { state: 'reading', attempt: shift.attempt + 1 });
  const after = await getShift(env, shift.id);
  if (!after) throw new HttpError(500, 'That did not save.');
  return after;
}

export async function setPaused(env: Env, reason: unknown): Promise<{ paused: boolean; reason: string | null }> {
  const text = reason === null || reason === '' ? '' : cleanText(reason, 140);
  if (text === null) throw new HttpError(400, 'A pause needs a reason.');
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('paused', ?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2`,
  ).bind(text, Date.now()).run();
  return { paused: Boolean(text), reason: text || null };
}

// What the watcher may send. Strictly shaped, so a bug or a hostile file name can't widen it.
const STATES = new Set(['reading', 'writing', 'testing', 'stuck']);
const CHANGES = new Set(['added', 'changed', 'removed']);
const PATH_SHAPE = /^[A-Za-z0-9_./-]{1,120}$/;
const MAX_EVENTS_PER_SHIFT = 2000;

export async function receiveLiveEvent(env: Env, body: Record<string, unknown>): Promise<{ stored: boolean }> {
  const shift = await requireOpen(env, body.shiftId);
  const events = await env.DB.prepare('SELECT COUNT(*) AS n FROM shift_events WHERE shift_id = ?')
    .bind(shift.id).first<{ n: number }>();
  if ((events?.n ?? 0) >= MAX_EVENTS_PER_SHIFT) return { stored: false };

  if (body.kind === 'state' && typeof body.state === 'string' && STATES.has(body.state)) {
    await env.DB.prepare(`UPDATE shifts SET state = ? WHERE id = ? AND status = 'live'`).bind(body.state, shift.id).run();
    await logEvent(env, shift.id, 'state', { state: body.state });
    return { stored: true };
  }
  if (body.kind === 'file' && typeof body.path === 'string' && typeof body.change === 'string') {
    if (!PATH_SHAPE.test(body.path) || !CHANGES.has(body.change)) throw new HttpError(400, 'Bad file event.');
    if (looksSecret(body.path)) {
      await logEvent(env, shift.id, 'redacted', { reason: 'a file name looked like a secret' });
      return { stored: false };
    }
    await logEvent(env, shift.id, 'file', { path: body.path, change: body.change });
    return { stored: true };
  }
  if (body.kind === 'test') {
    const passed = count(body.passed);
    const failed = count(body.failed);
    if (passed === null || failed === null) throw new HttpError(400, 'Bad test event.');
    await logEvent(env, shift.id, 'test', { passed, failed });
    return { stored: true };
  }
  if (body.kind === 'redacted') {
    await logEvent(env, shift.id, 'redacted', { reason: 'the watcher removed something that looked like a secret' });
    return { stored: true };
  }
  throw new HttpError(400, 'Unknown event.');
}

const STAGES = new Set(['rules', 'secrets', 'build', 'unit', 'browser', 'ship', 'verify', 'rollback']);

interface GateBody {
  shiftId?: unknown;
  attempt?: unknown;
  stage?: unknown;
  status?: unknown;
  detail?: unknown;
  runUrl?: unknown;
  version?: unknown;
  commit?: unknown;
  final?: unknown;
}

const isVersion = (value: unknown): value is string => typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value);
const isCommit = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{7,40}$/.test(value);

async function endShift(env: Env, shift: ShiftRow, status: ShiftRow['status']): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE shifts SET status = ?, state = ?, ended_at = ? WHERE id = ?`).bind(status, status, Date.now(), shift.id),
    env.DB.prepare(`UPDATE tasks SET status = ? WHERE id = ?`).bind(status, shift.task_id),
  ]);
  await logEvent(env, shift.id, 'state', { state: status });
}

export async function receiveGateEvent(env: Env, body: GateBody): Promise<{ status: string; shift?: ShiftRow }> {
  const shift = typeof body.shiftId === 'number' ? await getShift(env, body.shiftId) : null;
  if (!shift) throw new HttpError(404, 'No such shift.', 'no-shift');
  if (typeof body.stage !== 'string' || !STAGES.has(body.stage)) throw new HttpError(400, 'Unknown gate stage.');
  if (body.status !== 'pass' && body.status !== 'fail') throw new HttpError(400, 'status has to be pass or fail.');

  const detail = cleanText(body.detail, 500);
  const runUrl = gitHubUrl(body.runUrl);
  await env.DB.prepare(
    'INSERT INTO gate_results (shift_id, attempt, stage, status, detail, run_url, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(shift.id, shift.attempt, body.stage, body.status, detail, runUrl, Date.now()).run();
  await logEvent(env, shift.id, 'gate', { stage: body.stage, status: body.status, detail });

  await env.DB.prepare(
    `UPDATE shifts SET run_url = COALESCE(?, run_url), version = COALESCE(?, version), commit_sha = COALESCE(?, commit_sha) WHERE id = ?`,
  ).bind(runUrl, isVersion(body.version) ? body.version : null, isCommit(body.commit) ? body.commit : null, shift.id).run();

  if (body.final !== true) return { status: shift.status };

  // A rollback can arrive after a shift already read as shipped, so it's checked first.
  if (body.stage === 'rollback') {
    await endShift(env, shift, 'rolled-back');
    return { status: 'rolled-back' };
  }
  if (shift.status !== 'gate' && shift.status !== 'live') return { status: shift.status };
  if (body.status === 'pass') {
    await endShift(env, shift, 'shipped');
    return { status: 'shipped', shift };
  }
  if (shift.attempt >= MAX_ATTEMPTS) {
    await endShift(env, shift, 'failed');
    return { status: 'failed' };
  }
  return { status: 'gate-failed' };
}

export async function storeShot(env: Env, shiftId: number, kind: string, bytes: Uint8Array): Promise<void> {
  if (kind !== 'before' && kind !== 'after') throw new HttpError(400, 'before or after only.');
  const shift = await getShift(env, shiftId);
  if (!shift) throw new HttpError(404, 'No such shift.', 'no-shift');
  if (bytes.length > 600_000) throw new HttpError(413, 'That image is too big.');
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!png.every((b, i) => bytes[i] === b)) throw new HttpError(400, 'Only PNG images.');
  await env.DB.prepare(
    `INSERT INTO shift_media (shift_id, kind, bytes) VALUES (?1, ?2, ?3)
     ON CONFLICT(shift_id, kind) DO UPDATE SET bytes = ?3`,
  ).bind(shiftId, kind, bytes).run();
}

export async function readShot(env: Env, shiftId: number, kind: string): Promise<ArrayBuffer | null> {
  const row = await env.DB.prepare('SELECT bytes FROM shift_media WHERE shift_id = ? AND kind = ?')
    .bind(shiftId, kind).first<{ bytes: number[] | ArrayBuffer }>();
  if (!row) return null;
  return row.bytes instanceof ArrayBuffer ? row.bytes : new Uint8Array(row.bytes).buffer;
}
