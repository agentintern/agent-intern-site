import { dailySeed, dayNumber } from '../shared/daily';
import { SITE } from './config';
import type { Env } from './env';
import { clientIp, HttpError } from './http';
import { rateLimit } from './ratelimit';
import { normalizeTask, screenWithRules } from './screen';

interface ScoreBody {
  name?: unknown;
  score?: unknown;
  tasks?: unknown;
  coffees?: unknown;
  nearMisses?: unknown;
  duration?: unknown;
  version?: unknown;
  seed?: unknown;
}

const NAME_SHAPE = /^[A-Za-z0-9 _-]{1,16}$/;
const VERSION_SHAPE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000;

// Scores are casual and a browser can always lie. This only throws out what a run couldn't produce.
export function isPossible(body: ScoreBody): boolean {
  const { score, tasks, nearMisses, duration } = body;
  const limits = SITE.scores;
  if (!isCount(score) || !isCount(tasks) || !isCount(nearMisses) || typeof duration !== 'number') return false;
  if (!Number.isFinite(duration) || duration <= 0 || duration > limits.maxDurationSeconds) return false;
  if (tasks > duration * limits.maxTasksPerSecond) return false;
  if (nearMisses > duration * limits.maxCloseCallsPerSecond) return false;
  return score <= tasks * limits.maxPointsPerTask + nearMisses * limits.maxPointsPerCloseCall;
}

export async function submitScore(env: Env, request: Request, body: ScoreBody): Promise<{ rank: number; day: number | null }> {
  await rateLimit(env, 'score', clientIp(request), 12, 10 * 60 * 1000);
  const name = typeof body.name === 'string' ? normalizeTask(body.name) : '';
  if (!NAME_SHAPE.test(name)) throw new HttpError(422, 'Names are 1 to 16 letters, numbers, spaces, - or _.', 'bad-name');
  if (screenWithRules(name)) throw new HttpError(422, 'Pick another name.', 'bad-name');
  if (typeof body.version !== 'string' || !VERSION_SHAPE.test(body.version)) {
    throw new HttpError(422, 'That score looks wrong.', 'impossible');
  }
  if (!isPossible(body)) throw new HttpError(422, "That score isn't possible.", 'impossible');

  // A run counts for the day only if it played that day's office.
  const today = dayNumber(Date.now());
  const day = body.seed === dailySeed(today) ? today : null;
  await env.DB.prepare('INSERT INTO scores (name, score, tasks, duration, version, at, day) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(name, body.score, body.tasks, body.duration, body.version, Date.now(), day).run();
  const rank = await env.DB.prepare(
    day ? 'SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ? AND day = ?' : 'SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ?',
  ).bind(...(day ? [body.score, day] : [body.score])).first<{ rank: number }>();
  return { rank: rank?.rank ?? 0, day };
}

export interface ScoreRow {
  name: string;
  score: number;
  tasks: number;
  duration: number;
  version: string;
  at: number;
}

export async function leaderboard(env: Env, day?: number): Promise<ScoreRow[]> {
  const rows = day
    ? await env.DB.prepare('SELECT name, score, tasks, duration, version, at FROM scores WHERE day = ? ORDER BY score DESC, id ASC LIMIT 20').bind(day).all<ScoreRow>()
    : await env.DB.prepare('SELECT name, score, tasks, duration, version, at FROM scores ORDER BY score DESC, id ASC LIMIT 20').all<ScoreRow>();
  return rows.results;
}
