import { sessionWallet } from './auth';
import { SITE } from './config';
import type { Env } from './env';
import { clientIp, HttpError } from './http';
import { MINUTE, rateLimit } from './ratelimit';

// Web Push with no service in the middle: RFC 8291 encryption and a VAPID signature, both WebCrypto.
const encoder = new TextEncoder();
const text = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(encoder.encode(value));

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export async function encryptPayload(payload: string, p256dh: string, auth: string): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(p256dh);
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0], pair.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdf(fromB64url(auth), shared, concat(text('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, prk, text('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, text('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(encoder.encode(payload), Uint8Array.of(2))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return concat(header, asPublic, cipher);
}

async function vapidToken(env: Env, audience: string): Promise<string | null> {
  if (!env.VAPID_PRIVATE_JWK) return null;
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (value: object): string => b64url(encoder.encode(JSON.stringify(value)));
  const body = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: audience, exp: Math.floor(Date.now() / 1000) + 43_200, sub: SITE.siteOrigin })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(body)));
  return `${body}.${b64url(signature)}`;
}

interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
  wallet: string | null;
}

// Each message goes out once, whatever keeps asking. A dead subscription gets removed.
interface PushMessage {
  title: string;
  body: string;
  url: string;
}

// `personal` swaps the title for one wallet, which is how "your task shipped" reaches the person who proposed it.
export async function sendPush(env: Env, key: string, message: PushMessage, personal?: { wallet: string; title: string }): Promise<number> {
  if (!SITE.vapidPublic || !env.VAPID_PRIVATE_JWK) return 0;
  const claimed = await env.DB.prepare('INSERT OR IGNORE INTO push_sent (key, at) VALUES (?, ?)').bind(key, Date.now()).run();
  if (claimed.meta.changes !== 1) return 0;
  const subs = await env.DB.prepare('SELECT endpoint, p256dh, auth, wallet FROM push_subscriptions LIMIT 200').all<Subscription>();
  let sent = 0;
  for (const sub of subs.results) {
    try {
      const token = await vapidToken(env, new URL(sub.endpoint).origin);
      const response = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: '3600',
          authorization: `vapid t=${token}, k=${SITE.vapidPublic}`,
        },
        body: await encryptPayload(JSON.stringify(personal && sub.wallet === personal.wallet ? { ...message, title: personal.title } : message), sub.p256dh, sub.auth),
      });
      if (response.status === 404 || response.status === 410) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
      } else if (response.ok) {
        sent++;
      }
    } catch {
      // One bad endpoint doesn't stop the rest.
    }
  }
  return sent;
}

const WARN_BEFORE_MS = 60 * 60 * 1000;

// There's no scheduler, so this goes out on the first read in the last hour of a round. A quiet hour means a late
// warning, or none.
export async function warnVoteClosing(env: Env, origin: string): Promise<void> {
  const round = await env.DB.prepare(`SELECT id, closes_at FROM rounds WHERE status = 'open' ORDER BY id DESC LIMIT 1`).first<{ id: number; closes_at: number }>();
  if (!round || Date.now() < round.closes_at - WARN_BEFORE_MS || Date.now() >= round.closes_at) return;
  await sendPush(env, `closing:${round.id}`, { title: 'The vote closes within the hour', body: `Round ${round.id} is still open.`, url: `${origin}/board` });
}

const PUSH_HOST = /^https:\/\/[a-z0-9.-]+\.(googleapis\.com|mozilla\.com|windows\.com|apple\.com)\//;

export async function subscribePush(env: Env, request: Request, body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }): Promise<{ ok: true }> {
  await rateLimit(env, 'push', clientIp(request), 10, 10 * MINUTE);
  const { endpoint } = body;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  // Only real push services, so this can't be used to make the Worker call an address of someone's choosing.
  if (typeof endpoint !== 'string' || endpoint.length > 600 || !PUSH_HOST.test(endpoint)) throw new HttpError(400, "That isn't a push subscription.");
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) throw new HttpError(400, "That isn't a push subscription.");
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, wallet) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, wallet = ?5`,
  ).bind(endpoint, p256dh, auth, Date.now(), await sessionWallet(env, request)).run();
  return { ok: true };
}

export async function unsubscribePush(env: Env, body: { endpoint?: unknown }): Promise<{ ok: true }> {
  if (typeof body.endpoint === 'string') await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(body.endpoint).run();
  return { ok: true };
}
