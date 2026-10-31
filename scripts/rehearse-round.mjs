import { webcrypto as crypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// A real round on the live system for a rehearsal: real signatures, screening, votes and a real
// close. Only the close time is moved, so the winner reaches the queue now instead of at 18:00.
const SITE = 'https://agentintern.online';
const domain = new URL(SITE).host;
const text = process.argv[2];

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  const digits = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) { carry += digits[i] * 256; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let out = '';
  for (const byte of bytes) { if (byte !== 0) break; out += '1'; }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}
const body = (wallet, lines, n) => [`${domain} asks you to sign this message.`, '', ...lines, `Nonce: ${n.nonce}`, `Issued At: ${n.issuedAt}`, '', 'This is a plain message. It is not a transaction and it costs nothing.'].join('\n');
async function api(path, payload, cookie) {
  const r = await fetch(`${SITE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(payload) });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path}: ${json.error}`);
  return { json, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function holder() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const wallet = base58(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const sign = async (m) => base58(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(m))));
  const n = (await api('/api/auth/nonce', { wallet })).json;
  const { cookie } = await api('/api/auth/sign-in', { wallet, nonce: n.nonce, signature: await sign(body(wallet, ['Action: sign-in', `Wallet: ${wallet}`], n)) });
  return { wallet, sign, cookie };
}

const round = (await (await fetch(`${SITE}/api/board`)).json()).round.id;
const proposer = await holder();
let n = (await api('/api/auth/nonce', { wallet: proposer.wallet })).json;
const sig = await proposer.sign(body(proposer.wallet, ['Action: propose', `Wallet: ${proposer.wallet}`, `Round: ${round}`, `Task: ${text}`], n));
const { json: created } = await api('/api/proposals', { wallet: proposer.wallet, nonce: n.nonce, signature: sig, round, text }, proposer.cookie);
console.log(`round ${round}: proposal ${created.id} is ${created.status}`);
if (created.status !== 'open') process.exit(1);

for (let i = 0; i < 3; i++) {
  const voter = i === 0 ? proposer : await holder();
  n = (await api('/api/auth/nonce', { wallet: voter.wallet })).json;
  const voteSig = await voter.sign(body(voter.wallet, ['Action: vote', `Wallet: ${voter.wallet}`, `Round: ${round}`, `Proposal: ${created.id}`], n));
  await api('/api/votes', { wallet: voter.wallet, nonce: n.nonce, signature: voteSig, round, proposal: created.id }, voter.cookie);
}
console.log('3 signed votes in');

execFileSync('npx', ['wrangler', 'd1', 'execute', 'agent-intern', '--remote', '--command', `UPDATE rounds SET closes_at = ${Date.now() - 1000} WHERE id = ${round}`], { stdio: 'ignore' });
await fetch(`${SITE}/api/board?close=${Date.now()}`);
await new Promise((done) => setTimeout(done, 1500));
const state = await (await fetch(`${SITE}/api/state?x=${Date.now()}`)).json();
console.log(`round ${state.round.id} is now open. queue: ${state.queue.map((t) => `"${t.text}" (${t.votes} votes)`).join(', ')}`);
