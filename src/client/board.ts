import { verifySignature } from '../shared/verify';
import { ApiError, byId, get, h, need, post, say } from './dom';
import { refreshNow } from './refresh';
import { signedBody, testMode } from './session';
import { listenForWallets, testWallet, walletOptions, type Signer } from './wallet';

interface Me {
  wallet: string | null;
  balance?: string | null;
  pass?: boolean;
  slot?: number;
  rpcDown?: boolean;
  threshold?: number;
  vote?: number | null;
}

let signer: Signer | null = null;
let me: Me = { wallet: null };

const short = (wallet: string): string => `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : 'That did not work.');
const box = (): HTMLElement | null => byId('proposals-box');
const round = (): number => Number(box()?.dataset.round ?? 0);
const canAct = (): boolean => Boolean(signer && me.wallet === signer.address && me.pass && box()?.dataset.open === '1');

function connectList(): HTMLElement {
  const list = h('ul', { class: 'wallets' });
  for (const option of walletOptions()) {
    const button = h('button', { class: 'btn small', type: 'button' }, option.icon ? h('img', { src: option.icon, alt: '', width: '18', height: '18' }) : null, option.name);
    button.addEventListener('click', () => { option.connect().then(signIn).catch((cause: unknown) => renderPass(errorText(cause))); });
    list.append(h('li', {}, button));
  }
  if (testMode()) {
    const button = h('button', { class: 'btn small ghost', type: 'button', id: 'test-wallet' }, 'Use a test wallet');
    button.addEventListener('click', () => { void testWallet().then(signIn); });
    list.append(h('li', {}, button));
  } else if (list.children.length === 0) {
    list.append(h('li', { class: 'muted' }, 'No Solana wallet found in this browser.'));
  }
  return list;
}

function renderPass(problem?: string): void {
  const pass = need('pass');
  const error = problem ? h('p', { class: 'error', role: 'alert' }, problem) : null;
  pass.replaceChildren();
  if (!me.wallet) {
    pass.append(h('p', {}, `Connect a Solana wallet and sign a plain message. It isn't a transaction and it costs nothing. A pass needs ${pass.dataset.threshold ?? ''}.`), connectList());
    if (error) pass.append(error);
    return;
  }
  const out = h('button', { class: 'btn small ghost', type: 'button' }, 'Sign out');
  out.addEventListener('click', () => { void post('/api/auth/sign-out', {}).then(() => { signer = null; me = { wallet: null }; return load(); }); });
  pass.append(h('p', {}, h('strong', {}, short(me.wallet)), ` holds ${me.balance ?? 'unknown'}${me.slot ? `, read at slot ${me.slot}` : ''}.`));
  pass.append(me.rpcDown
    ? h('p', { class: 'error' }, "Voting is paused: balances can't be read right now.")
    : me.pass
      ? h('p', { class: 'ok', id: 'pass-state' }, 'You have a pass.')
      : h('p', { class: 'error', id: 'pass-state' }, `No pass: you need ${(me.threshold ?? 0).toLocaleString('en-US')}.`));
  if (!signer) pass.append(h('p', { class: 'hint' }, 'Reconnect your wallet to sign votes.'), connectList());
  if (testMode()) {
    const input = h('input', { id: 'test-balance', type: 'number', min: '0', step: '1', value: me.balance ?? '0' });
    const save = h('button', { class: 'btn small ghost', type: 'button', id: 'test-balance-save' }, 'Set fake balance');
    save.addEventListener('click', () => { post('/api/test/balance', { balance: Number(input.value) }).then(load).catch((cause: unknown) => renderPass(errorText(cause))); });
    pass.append(h('div', { class: 'field' }, h('label', { for: 'test-balance' }, 'TEST MODE: pretend balance'), input, save));
  }
  pass.append(h('p', {}, out));
  if (error) pass.append(error);
}

export function afterSwap(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-vote]')) {
    const mine = me.vote === Number(button.dataset.vote);
    button.disabled = !canAct();
    button.textContent = mine ? 'Your vote' : 'Vote';
    button.classList.toggle('ghost', !mine);
    button.setAttribute('aria-pressed', mine ? 'true' : 'false');
  }
  const propose = byId<HTMLButtonElement>('propose-button');
  if (propose) propose.disabled = !canAct();
}

async function load(): Promise<void> {
  me = await get<Me>('/api/me');
  await refreshNow();
  renderPass();
  afterSwap();
}

async function signIn(next: Signer): Promise<void> {
  signer = next;
  try {
    await post('/api/auth/sign-in', await signedBody(next, { action: 'sign-in' }));
    await load();
  } catch (cause) {
    signer = null;
    renderPass(errorText(cause));
  }
}

export async function startBoard(): Promise<void> {
  document.addEventListener('click', (event) => {
    const el = event.target as HTMLElement;
    const voteButton = el.closest<HTMLButtonElement>('[data-vote]');
    if (voteButton && signer) {
      const proposal = Number(voteButton.dataset.vote);
      voteButton.disabled = true;
      const current = signer;
      signedBody(current, { action: 'vote', round: round(), proposal })
        .then((body) => post('/api/votes', { ...body, round: round(), proposal }))
        .then(load)
        .catch((cause: unknown) => { renderPass(errorText(cause)); voteButton.disabled = false; });
    }
    const check = el.closest<HTMLElement>('[data-verify]');
    if (check) {
      const { wallet = '', message = '', signature = '' } = check.dataset;
      const result = check.nextElementSibling as HTMLElement | null;
      void verifySignature(wallet, message, signature).then((ok) => say(result, ok ? ' valid' : ' does not match', ok ? 'ok' : 'error'));
      need<HTMLInputElement>('verify-wallet').value = wallet;
      need<HTMLTextAreaElement>('verify-message').value = message;
      need<HTMLInputElement>('verify-signature').value = signature;
    }
  });

  const text = need<HTMLTextAreaElement>('task-text');
  text.addEventListener('input', () => { need('task-count').textContent = String(text.value.length); });
  need<HTMLFormElement>('propose-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!signer) return;
    const message = byId('propose-message');
    const value = text.value;
    const current = round();
    say(message, 'Check your wallet to sign.');
    signedBody(signer, { action: 'propose', round: current, text: value })
      .then((body) => post<{ status: string; reason: string | null }>('/api/proposals', { ...body, round: current, text: value }))
      .then((result) => {
        if (result.status === 'rejected') say(message, `Turned down: ${result.reason ?? 'it broke a rule.'}`, 'error');
        else {
          say(message, result.status === 'open' ? 'It passed screening and is up for votes.' : 'Saved. The agent check is busy, so it will be reviewed shortly.', 'ok');
          text.value = '';
          need('task-count').textContent = '0';
        }
        return load();
      })
      .catch((cause: unknown) => say(message, cause instanceof ApiError ? cause.message : errorText(cause), 'error'));
  });

  need<HTMLFormElement>('verify-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const wallet = need<HTMLInputElement>('verify-wallet').value.trim();
    const message = need<HTMLTextAreaElement>('verify-message').value.replace(/\r\n/g, '\n');
    const signature = need<HTMLInputElement>('verify-signature').value.trim();
    void verifySignature(wallet, message, signature).then((ok) => say(byId('verify-result'), ok ? 'Valid. This wallet signed this exact message.' : "Doesn't match. This wallet did not sign this message.", ok ? 'ok' : 'error'));
  });

  listenForWallets(() => { if (!me.wallet) renderPass(); });
  me = await get<Me>('/api/me');
  renderPass();
  afterSwap();
}
