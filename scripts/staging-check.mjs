import { webcrypto as crypto } from 'node:crypto';

// Walks a throwaway wallet through the live flow on the staging address. Staging runs a made-up mint, so the balance
// read fails, and this proves what happens then: signing in works, and writes stop with a plain message.
const SITE = 'https://staging.agent-intern.pages.dev';
const domain = new URL(SITE).host;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  const digits = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return digits.reverse().map((d) => ALPHABET[d]).join('');
}
async function post(path, payload, cookie) {
  const response = await fetch(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json().catch(() => null), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const wallet = base58(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const sign = async (text) => base58(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(text))));
const signed = (n, lines) =>
  [`${domain} asks you to sign this message.`, '', ...lines, `Nonce: ${n.nonce}`, `Issued At: ${n.issuedAt}`, '', 'This is a plain message. It is not a transaction and it costs nothing.'].join('\n');

const n1 = (await post('/api/auth/nonce', { wallet })).body;
const session = await post('/api/auth/sign-in', { wallet, nonce: n1.nonce, signature: await sign(signed(n1, ['Action: sign-in', `Wallet: ${wallet}`])) });
console.log('sign in:', session.status, JSON.stringify(session.body).slice(0, 140));

const me = await fetch(`${SITE}/api/me`, { headers: { cookie: session.cookie ?? '' } });
console.log('me:', me.status, (await me.text()).slice(0, 180));

const round = (await (await fetch(`${SITE}/api/board`)).json()).round.id;
const text = 'Add a stapler that follows you around';
const n2 = (await post('/api/auth/nonce', { wallet })).body;
const proposal = await post('/api/proposals', {
  wallet, nonce: n2.nonce, text, round,
  signature: await sign(signed(n2, ['Action: propose', `Wallet: ${wallet}`, `Round: ${round}`, `Task: ${text}`])),
}, session.cookie);
console.log('propose:', proposal.status, JSON.stringify(proposal.body).slice(0, 160));

const status = await (await fetch(`${SITE}/api/status`)).json();
console.log('rpc:', JSON.stringify(status.rpc));
