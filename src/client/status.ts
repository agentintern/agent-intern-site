import { get, type Pause, type Round, type Shift } from './api';
import { initChrome, showShiftPill } from './chrome';
import { byId, fill, h, poll, when } from './dom';
import { statusStamp } from './stamps';

interface Status {
  config: { mode: string; repos: { site: string; game: string } };
  pause: Pause;
  rpc: { state: string; lastOk?: number | null; lastFail?: number | null };
  round: Round;
  queueLength: number;
  game: { ok: boolean; version?: string | null; detail?: string };
  lastShift: Shift | null;
  gate: { shift: number; attempt: number; stage: string; status: string; detail: string | null }[];
  counts: { total: number; shipped: number | null; refused: number | null; failed: number | null; rolledBack: number | null };
  checkedAt: number;
}

const row = (label: string, value: Node | string): HTMLElement =>
  h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, value));

const health = (ok: boolean, good: string, bad: string): HTMLElement =>
  h('span', { class: `stamp ${ok ? 'good' : 'bad'}` }, ok ? good : bad);

function rpcLine(rpc: Status['rpc']): HTMLElement {
  if (rpc.state === 'test-mode') return h('span', { class: 'stamp note' }, 'test mode: fake balances');
  if (rpc.state === 'unknown') return h('span', { class: 'stamp' }, 'not read yet');
  return health(rpc.state === 'ok', 'healthy', 'down: voting paused');
}

function render(status: Status): void {
  showShiftPill(status.lastShift && ['live', 'gate'].includes(status.lastShift.status) ? status.lastShift : null, status.pause);
  fill(byId('now'), h('table', {}, h('tbody', {},
    row('Mode', status.config.mode === 'test' ? 'TEST MODE' : 'live'),
    row('Voting', status.pause.paused ? `paused: ${status.pause.reason ?? ''}` : `round ${status.round.id}, ${status.round.status}`),
    row('Next close', when(status.round.closesAt)),
    row('Queue', `${status.queueLength} waiting`),
    row('Balance reads', rpcLine(status.rpc)),
    row('Game', health(status.game.ok, `live, v${status.game.version ?? '?'}`, status.game.detail ?? 'unreachable')),
    row('Shifts', `${status.counts.total} total, ${status.counts.shipped ?? 0} shipped, ${status.counts.refused ?? 0} refused, ${status.counts.failed ?? 0} failed, ${status.counts.rolledBack ?? 0} rolled back`),
    row('Checked', when(status.checkedAt)),
  )));

  const last = status.lastShift;
  fill(byId('last'), last
    ? h('table', {}, h('tbody', {},
        row('Shift', h('a', { href: `/shift/${last.id}` }, `#${last.id}`)),
        row('Task', last.task),
        row('Result', statusStamp(last.status)),
        row('Started', when(last.startedAt)),
      ))
    : h('p', { class: 'empty' }, 'No shifts yet.'));

  const gate = byId('gate');
  if (status.gate.length === 0) {
    fill(gate, h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'Nothing has reached the gate yet.')));
  } else {
    fill(gate, ...status.gate.map((g) =>
      h('tr', {},
        h('td', {}, h('a', { href: `/shift/${g.shift}` }, `#${g.shift}`)),
        h('td', {}, g.attempt),
        h('td', {}, g.stage),
        h('td', {}, h('span', { class: `stamp ${g.status === 'pass' ? 'good' : 'bad'}` }, g.status)),
        h('td', { class: 'break' }, g.detail ?? ''))));
  }
}

void initChrome();
poll(async () => render(await get<Status>('/api/status')), () => 30_000);
