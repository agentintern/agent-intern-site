import { buildMessage, type SignedAction } from '../shared/message';
import { base58Decode } from '../shared/base58';
import { verifySignature } from '../shared/verify';
import { NONCE_TTL_MS, SESSION_TTL_MS, siteDomain } from './config';
import type { Env } from './env';
import { HttpError, randomToken, sha256Hex } from './http';

const COOKIE = '__Host-pass';

export function isWallet(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 44 && base58Decode(value)?.length === 32;
}

export async function issueNonce(env: Env, wallet: string): Promise<{ nonce: string; issuedAt: string }> {
  const now = Date.now();
  const nonce = randomToken(16);
  const issuedAt = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM nonces WHERE created_at < ?').bind(now - NONCE_TTL_MS * 4),
    env.DB.prepare('INSERT INTO nonces (nonce, wallet, issued_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(nonce, wallet, issuedAt, now),
  ]);
  return { nonce, issuedAt };
}

export interface SignedRequest {
  wallet: string;
  nonce: string;
  signature: string;
}

// Rebuilds the message from server-side facts, checks the signature, then burns the nonce. The nonce
// is only spent after a good signature, and the update makes sure it can be spent once.
export async function verifySigned(env: Env, input: SignedRequest, signed: SignedAction): Promise<string> {
  if (!isWallet(input.wallet) || typeof input.nonce !== 'string' || typeof input.signature !== 'string') {
    throw new HttpError(400, 'That signature is incomplete.', 'bad-signature');
  }
  const row = await env.DB.prepare('SELECT wallet, issued_at, created_at, used_at FROM nonces WHERE nonce = ?')
    .bind(input.nonce)
    .first<{ wallet: string; issued_at: string; created_at: number; used_at: number | null }>();
  if (!row || row.wallet !== input.wallet) throw new HttpError(401, 'That sign-in request is unknown.', 'bad-nonce');
  if (row.used_at !== null) throw new HttpError(401, 'That signature was already used.', 'replayed');
  const now = Date.now();
  if (now - row.created_at > NONCE_TTL_MS) throw new HttpError(401, 'That request expired. Try again.', 'expired');

  const message = buildMessage(siteDomain(env), input.wallet, signed, input.nonce, row.issued_at);
  if (!(await verifySignature(input.wallet, message, input.signature))) {
    throw new HttpError(401, "That signature doesn't match.", 'bad-signature');
  }

  const burn = await env.DB.prepare('UPDATE nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL')
    .bind(now, input.nonce).run();
  if (burn.meta.changes !== 1) throw new HttpError(401, 'That signature was already used.', 'replayed');
  return message;
}

function readCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE && value) return value;
  }
  return null;
}

export async function createSession(env: Env, wallet: string): Promise<string> {
  const now = Date.now();
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (token_hash, wallet, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256Hex(token), wallet, now, now + SESSION_TTL_MS),
  ]);
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export const CLEAR_COOKIE = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export async function sessionWallet(env: Env, request: Request): Promise<string | null> {
  const token = readCookie(request);
  if (!token) return null;
  const row = await env.DB.prepare('SELECT wallet FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(token), Date.now()).first<{ wallet: string }>();
  return row?.wallet ?? null;
}

export async function requireSession(env: Env, request: Request): Promise<string> {
  const wallet = await sessionWallet(env, request);
  if (!wallet) throw new HttpError(401, 'Sign in with your wallet first.', 'no-session');
  return wallet;
}

export async function dropSession(env: Env, request: Request): Promise<void> {
  const token = readCookie(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}
