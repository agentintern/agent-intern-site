import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { base58Encode } from '../src/shared/base58';
import { buildMessage, type SignedAction } from '../src/shared/message';
import type { Env } from '../src/worker/env';
import { handle } from '../src/worker/index';

export const ORIGIN = 'https://agent-intern.pages.dev';
export const DOMAIN = 'agent-intern.pages.dev';

export interface Wallet {
  address: string;
  sign(message: string): Promise<string>;
}

export async function newWallet(): Promise<Wallet> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return {
    address: base58Encode(raw),
    sign: async (message) => {
      const sig = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message));
      return base58Encode(new Uint8Array(sig));
    },
  };
}

export type AiAnswer = string | Error | undefined;

export interface Harness {
  env: Env;
  db: D1Database;
  ai: { answer: AiAnswer; calls: string[] };
  call(path: string, init?: CallInit): Promise<{ status: number; body: any; headers: Headers }>;
  signIn(wallet: Wallet, domain?: string): Promise<string>;
  signed(wallet: Wallet, cookie: string, path: string, action: SignedAction, extra: object): Promise<{ status: number; body: any }>;
  propose(wallet: Wallet, cookie: string, round: number, text: string): Promise<{ status: number; body: any }>;
  vote(wallet: Wallet, cookie: string, round: number, proposal: number): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

interface CallInit {
  method?: string;
  body?: unknown;
  cookie?: string;
  bearer?: string;
  origin?: string | null;
}

export async function createHarness(): Promise<Harness> {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("") } }', d1Databases: ['DB'] });
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  const schema = readFileSync(fileURLToPath(new URL('../migrations/0001_init.sql', import.meta.url).href), 'utf8');
  for (const statement of schema.replace(/--.*$/gm, '').split(/;\s*$/m)) {
    if (statement.trim()) await db.prepare(statement).run();
  }

  const ai: Harness['ai'] = { answer: 'OK', calls: [] };
  const env: Env = {
    DB: db,
    AI: {
      async run(_model, input) {
        const { messages } = input as { messages: { content: string }[] };
        ai.calls.push(messages.at(-1)?.content ?? '');
        if (ai.answer instanceof Error) throw ai.answer;
        return { response: ai.answer };
      },
    },
    SHIFT_TOKEN: 'shift-secret',
    WATCHER_TOKEN: 'watcher-secret',
    GATE_TOKEN: 'gate-secret',
    IP_SALT: 'salt',
  };
  const ctx = { waitUntil: () => {} };

  const call: Harness['call'] = async (path, init = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
    if (init.cookie) headers.cookie = init.cookie;
    if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
    const request = new Request(`${ORIGIN}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const response = await handle(request, env, ctx);
    const text = await response.clone().text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* binary */ }
    return { status: response.status, body, headers: response.headers };
  };

  const nonce = async (wallet: Wallet): Promise<{ nonce: string; issuedAt: string }> =>
    (await call('/api/auth/nonce', { body: { wallet: wallet.address } })).body;

  const signIn: Harness['signIn'] = async (wallet, domain = DOMAIN) => {
    const n = await nonce(wallet);
    const message = buildMessage(domain, wallet.address, { action: 'sign-in' }, n.nonce, n.issuedAt);
    const res = await call('/api/auth/sign-in', {
      body: { wallet: wallet.address, nonce: n.nonce, signature: await wallet.sign(message) },
    });
    return res.headers.get('set-cookie')?.split(';')[0] ?? `failed:${res.status}:${res.body.code}`;
  };

  const signed: Harness['signed'] = async (wallet, cookie, path, action, extra) => {
    const n = await nonce(wallet);
    const message = buildMessage(DOMAIN, wallet.address, action, n.nonce, n.issuedAt);
    return call(path, {
      cookie,
      body: { wallet: wallet.address, nonce: n.nonce, signature: await wallet.sign(message), ...extra },
    });
  };

  return {
    env, db, ai, call, signIn, signed,
    propose: (wallet, cookie, round, text) =>
      signed(wallet, cookie, '/api/proposals', { action: 'propose', round, text }, { round, text }),
    vote: (wallet, cookie, round, proposal) =>
      signed(wallet, cookie, '/api/votes', { action: 'vote', round, proposal }, { round, proposal }),
    close: () => mf.dispose(),
  };
}
