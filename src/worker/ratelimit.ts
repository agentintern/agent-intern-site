import type { Env } from './env';
import { HttpError, sha256Hex } from './http';

// A fixed window counter in D1. It's plain on purpose: these limits exist to stop floods, not to be exact.
export async function rateLimit(env: Env, scope: string, who: string, limit: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const key = `${scope}:${await sha256Hex(`${env.IP_SALT ?? ''}:${who}`)}`;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
     RETURNING count`,
  ).bind(key, now + windowMs, now).first<{ count: number }>();
  if ((row?.count ?? 0) > limit) throw new HttpError(429, 'Slow down a little.', 'rate-limited');
}
