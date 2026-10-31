import site from '../../config/site.json';
import token from '../../config/token.json';
import backlog from '../../config/backlog.json';
import type { Env } from './env';

export const SITE = site;
export const BACKLOG: readonly { id: string; text: string }[] = backlog;
export const NONCE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const TEST_DEFAULT_BALANCE = 250_000;
export const MAX_TASK_LENGTH = 120;
export const MAX_ATTEMPTS = 3;

export const testMode = (): boolean => !token.mint;
export const mint = (): string => token.mint;
export const threshold = (): number => token.threshold;

export function siteOrigin(env: Env): string {
  return env.SITE_ORIGIN || SITE.siteOrigin;
}

export function siteDomain(env: Env): string {
  return new URL(siteOrigin(env)).host;
}
