import { siteOrigin } from './config';
import type { Env } from './env';

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'error') {
    super(message);
  }
}

export function json(body: unknown, init: { status?: number; maxAge?: number; headers?: Record<string, string> } = {}): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'cache-control': init.maxAge ? `public, max-age=${init.maxAge}` : 'no-store',
    ...init.headers,
  };
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

const MAX_BODY_BYTES = 8 * 1024;

export async function readJson<T>(request: Request, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new HttpError(413, 'That is too big.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'That is too big.');
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) throw new Error('not an object');
    return value as T;
  } catch {
    throw new HttpError(400, 'That is not valid JSON.');
  }
}

// Browser writes must come from our own pages. Cookies are SameSite=Strict as well.
export function requireSameOrigin(request: Request, env: Env): void {
  if (request.headers.get('origin') !== siteOrigin(env)) {
    throw new HttpError(403, 'Requests have to come from the site.', 'bad-origin');
  }
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export async function sha256Hex(value: string): Promise<string> {
  return [...(await digest(value))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Hashing both sides first gives equal-length inputs, so the compare leaks nothing useful.
export async function requireBearer(request: Request, expected: string | undefined): Promise<void> {
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!expected || !given) throw new HttpError(401, 'Not allowed.', 'unauthorized');
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  if (diff !== 0) throw new HttpError(401, 'Not allowed.', 'unauthorized');
}

export function randomToken(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'local';
}
