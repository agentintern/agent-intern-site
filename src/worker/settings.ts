import type { Env } from './env';

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3`,
  ).bind(key, value, Date.now()).run();
}

export interface Pause {
  paused: boolean;
  reason: string | null;
}

export async function getPause(env: Env): Promise<Pause> {
  const reason = await getSetting(env, 'paused');
  return { paused: Boolean(reason), reason: reason || null };
}
