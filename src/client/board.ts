import { buildMessage, type SignedAction } from '../shared/message';
import { verifySignature } from '../shared/verify';
import { ApiError, get, post, type Pause, type Proposal, type Round, type Task } from './api';
import { initChrome, showShiftPill } from './chrome';
import { byId, countdown, fill, h, maybeId, poll, setText, when } from './dom';
import { renderQueue } from './queue';
import { listenForWallets, testWallet, walletOptions, type Signer } from './wallet';

declare const __TEST_MODE__: boolean;

interface Board {
  config: { threshold: number };
  round: Round;
  proposals: Proposal[];
  pause: Pause;
  queue: Task[];
}

interface Me {
  wallet: string | null;
  balance?: string | null;
  pass?: boolean;
  slot?: number;
  rpcDown?: boolean;
  threshold?: number;
  vote?: number | null;
}

interface VoteRecord {
  wallet: string;
  proposal: number;
  signature: string;
  message: string;
  slot: number;
  balance: string;
  counted: number | null;
}

const domain = location.host;
let signer: Signer | null = null;
let me: Me = { wallet: null };
let board: Board | null = null;

const short = (wallet: string): string => `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
const canAct = (): boolean => Boolean(signer && me.wallet === signer.address && me.pass && board?.round.status === 'open' && !board.pause.paused);

async function signedBody(signed: SignedAction): Promise<{ wallet: string; nonce: string; signature: string }> {
  if (!signer) throw new Error('Connect a wallet first.');
  const { nonce, issuedAt } = await post<{ nonce: string; issuedAt: string }>('/api/auth/nonce', { wallet: signer.address });
  const message = buildMessage(domain, signer.address, signed, nonce, issuedAt);
  return { wallet: signer.address, nonce, signature: await signer.sign(message) };
}

const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : 'That did not work.');

async function signIn(next: Signer): Promise<void> {
  signer = next;
  try {
    me = { ...(await post<Me>('/api/auth/sign-in', await signedBody({ action: 'sign-in' }))), vote: null };
    await refresh();
  } catch (cause) {
    signer = null;
    renderPass(errorText(cause));
  }
}

async function signOut(): Promise<void> {
  await post('/api/auth/sign-out', {});
  signer = null;
  me = { wallet: null };
  await refresh();
}

function connectOptions(): HTMLElement {
  const options = walletOptions();
  const list = h('ul', { class: 'wallets' });
  for (const option of options) {
    const button = h('button', { class: 'btn small', type: 'button' },
      option.icon ? h('img', { src: option.icon, alt: '', width: '18', height: '18' }) : null,
      option.name);
    button.addEventListener('click', () => {
      option.connect().then(signIn).catch((cause: unknown) => renderPass(errorText(cause)));
    });
    list.append(h('li', {}, button));
  }
  if (__TEST_MODE__) {
    const button = h('button', { class: 'btn small ghost', type: 'button', id: 'test-wallet' }, 'Use a test wallet');
    button.addEventListener('click', () => { void testWallet().then(signIn); });
    list.append(h('li', {}, button));
  }
  if (options.length === 0 && !__TEST_MODE__) {
    list.append(h('li', { class: 'muted' }, 'No Solana wallet found in this browser.'));
  }
  return list;
}

function testBalanceControl(): HTMLElement | null {
  if (!__TEST_MODE__) return null;
  const input = h('input', { id: 'test-balance', type: 'number', min: '0', step: '1', value: me.balance ?? '0' });
  const save = h('button', { class: 'btn small ghost', type: 'button', id: 'test-balance-save' }, 'Set fake balance');
  save.addEventListener('click', () => {
    post('/api/test/balance', { balance: Number(input.value) }).then(refresh).catch((cause: unknown) => renderPass(errorText(cause)));
  });
  return h('div', { class: 'field', 'data-mt': '12' }, h('label', { for: 'test-balance' }, 'TEST MODE: pretend balance'), input, save);
}

function renderPass(problem?: string): void {
  const box = byId('pass');
  const error = problem ? h('p', { class: 'error', role: 'alert' }, problem) : null;
  if (!me.wallet) {
    fill(box,
      h('p', {}, `Connect a Solana wallet and sign a plain message. It isn't a transaction and it costs nothing. A pass needs ${(board?.config.threshold ?? 0).toLocaleString('en-US')}.`),
      connectOptions(),
      error);
    return;
  }
  const signOutButton = h('button', { class: 'btn small ghost', type: 'button' }, 'Sign out');
  signOutButton.addEventListener('click', () => void signOut());
  const status = me.rpcDown
    ? h('p', { class: 'error' }, "Voting is paused: balances can't be read right now.")
    : me.pass
      ? h('p', { class: 'ok', id: 'pass-state' }, 'You have a pass.')
      : h('p', { class: 'error', id: 'pass-state' }, `No pass: you need ${(me.threshold ?? 0).toLocaleString('en-US')}.`);
  const reconnect = !signer ? h('p', { class: 'hint' }, 'Reconnect your wallet to sign votes.') : null;
  fill(box,
    h('p', {}, h('strong', {}, short(me.wallet)), ` holds ${me.balance ?? 'unknown'}`, me.slot ? `, read at slot ${me.slot}.` : '.'),
    status,
    reconnect,
    !signer ? connectOptions() : null,
    testBalanceControl(),
    h('p', { 'data-mt': '8' }, signOutButton),
    error);
}

function voteButton(proposal: Proposal): HTMLElement {
  const mine = me.vote === proposal.id;
  const button = h('button', { class: `btn small${mine ? '' : ' ghost'}`, type: 'button', disabled: !canAct(), 'aria-pressed': mine ? 'true' : 'false', 'data-vote': String(proposal.id) },
    mine ? 'Your vote' : 'Vote');
  button.addEventListener('click', () => {
    if (!board) return;
    const round = board.round.id;
    button.disabled = true;
    signedBody({ action: 'vote', round, proposal: proposal.id })
      .then((body) => post('/api/votes', { ...body, round, proposal: proposal.id }))
      .then(refresh)
      .catch((cause: unknown) => {
        renderPass(errorText(cause));
        button.disabled = false;
      });
  });
  return button;
}

function renderBoard(data: Board): void {
  setText('round-id', String(data.round.id));
  setText('round-line', data.round.status === 'open' ? `closes ${when(data.round.closesAt)}` : 'Counting the votes.');
  const open = data.proposals.filter((p) => p.status === 'open' || p.status === 'screening');
  const rejected = data.proposals.filter((p) => p.status === 'rejected');

  const list = byId('proposals');
  if (open.length === 0) {
    fill(list, h('li', { class: 'empty' }, 'No tasks this round yet.'));
  } else {
    fill(list, ...open.map((proposal) =>
      h('li', { 'data-proposal': String(proposal.id) },
        h('span', {}, proposal.text),
        proposal.status === 'screening'
          ? h('span', { class: 'stamp note' }, 'in review')
          : h('span', { class: 'btn-row' }, h('span', { class: 'count' }, `${proposal.votes}`), voteButton(proposal)),
        h('span', { class: 'meta' }, `by ${proposal.by}`),
      )));
  }

  const out = byId('rejected');
  if (rejected.length === 0) {
    fill(out, h('li', { class: 'empty' }, 'Nothing yet.'));
  } else {
    fill(out, ...rejected.map((proposal) =>
      h('li', {},
        h('span', {}, proposal.text),
        h('span', { class: 'stamp bad' }, 'rejected'),
        h('span', { class: 'meta' }, proposal.reason ?? ''),
      )));
  }
  renderQueue(data.queue);
  byId<HTMLButtonElement>('propose-button').disabled = !canAct();
}

async function renderRecord(round: number): Promise<void> {
  byId<HTMLAnchorElement>('record-link').href = `/api/votes/${round}`;
  const { votes } = await get<{ votes: VoteRecord[] }>(`/api/votes/${round}`);
  const body = byId('record');
  if (votes.length === 0) {
    fill(body, h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'No votes yet.')));
    return;
  }
  fill(body, ...votes.slice(0, 100).map((vote) => {
    const result = h('span', { role: 'status' });
    const check = h('button', { class: 'btn small ghost', type: 'button', 'data-verify': vote.wallet }, 'Verify');
    check.addEventListener('click', () => {
      void verifySignature(vote.wallet, vote.message, vote.signature).then((ok) => {
        result.textContent = ok ? ' valid' : ' does not match';
        result.className = ok ? 'ok' : 'error';
      });
      byId<HTMLInputElement>('verify-wallet').value = vote.wallet;
      byId<HTMLTextAreaElement>('verify-message').value = vote.message;
      byId<HTMLInputElement>('verify-signature').value = vote.signature;
    });
    return h('tr', {},
      h('td', { class: 'break' }, short(vote.wallet)),
      h('td', {}, `#${vote.proposal}`),
      h('td', { class: 'num' }, vote.balance),
      h('td', { class: 'num' }, vote.slot),
      h('td', {}, check, result));
  }));
}

async function refresh(): Promise<void> {
  const [data, session] = await Promise.all([get<Board>('/api/board'), get<Me>('/api/me')]);
  board = data;
  me = session;
  showShiftPill(null, data.pause);
  renderBoard(data);
  renderPass();
  await renderRecord(data.round.id);
}

const text = byId<HTMLTextAreaElement>('task-text');
text.addEventListener('input', () => setText('task-count', String(text.value.length)));

byId<HTMLFormElement>('propose-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!board) return;
  const round = board.round.id;
  const message = byId('propose-message');
  message.textContent = 'Check your wallet to sign.';
  message.className = '';
  const value = text.value;
  signedBody({ action: 'propose', round, text: value })
    .then((body) => post<{ status: string; reason: string | null }>('/api/proposals', { ...body, round, text: value }))
    .then((result) => {
      if (result.status === 'rejected') {
        message.textContent = `Turned down: ${result.reason ?? 'it broke a rule.'}`;
        message.className = 'error';
      } else {
        message.textContent = result.status === 'open' ? 'It passed screening and is up for votes.' : 'Saved. The agent check is busy, so it will be reviewed shortly.';
        message.className = 'ok';
        text.value = '';
        setText('task-count', '0');
      }
      return refresh();
    })
    .catch((cause: unknown) => {
      message.textContent = cause instanceof ApiError ? cause.message : errorText(cause);
      message.className = 'error';
    });
});

byId<HTMLFormElement>('verify-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const wallet = byId<HTMLInputElement>('verify-wallet').value.trim();
  const message = byId<HTMLTextAreaElement>('verify-message').value.replace(/\r\n/g, '\n');
  const signature = byId<HTMLInputElement>('verify-signature').value.trim();
  void verifySignature(wallet, message, signature).then((ok) => {
    const result = byId('verify-result');
    result.textContent = ok ? 'Valid. This wallet signed this exact message.' : "Doesn't match. This wallet did not sign this message.";
    result.className = ok ? 'ok' : 'error';
  });
});

setInterval(() => {
  if (board) setText('countdown', countdown(board.round.closesAt - Date.now()));
}, 1000);

listenForWallets(() => { if (maybeId('pass') && !me.wallet) renderPass(); });
void initChrome();
poll(refresh, () => 12_000);
