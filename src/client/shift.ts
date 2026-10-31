import { get, type Shift } from './api';
import { initChrome } from './chrome';
import { byId, fill, h, poll, setText, when } from './dom';
import { labels, statusStamp } from './stamps';

interface Gate {
  attempt: number;
  stage: string;
  status: string;
  detail: string | null;
  runUrl: string | null;
}

interface Detail {
  shift: Shift;
  gate: Gate[];
  shots: string[];
  votes: { total: number; counted: number } | null;
  repos: { game: string };
}

const id = Number(location.pathname.split('/').filter(Boolean).pop());

function row(label: string, value: Node | string | null): HTMLElement | null {
  if (value === null || value === '') return null;
  return h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, value));
}

function postText(shift: Shift): string {
  const task = shift.task.length > 110 ? `${shift.task.slice(0, 107)}...` : shift.task;
  const url = `${location.origin}/shift/${shift.id}`;
  const lead: Record<string, string> = {
    shipped: `Shift ${shift.id} shipped v${shift.version ?? ''}: "${task}"`,
    refused: `Shift ${shift.id}: the intern refused "${task}"`,
    failed: `Shift ${shift.id} failed the gate on "${task}"`,
    'rolled-back': `Shift ${shift.id} shipped "${task}", broke, and rolled back.`,
  };
  const credit = shift.kind === 'intern' ? "It was the intern's choice." : shift.proposer ? `Proposed by ${shift.proposer}.` : '';
  return [lead[shift.status] ?? `Shift ${shift.id} is on: "${task}"`, credit, 'Holders vote, the intern ships it.', url].filter(Boolean).join('\n');
}

function render(detail: Detail): void {
  const { shift } = detail;
  document.title = `Shift ${shift.id} | Agent Intern`;
  setText('shift-heading', `Shift ${shift.id}`);
  fill(byId('shift-title'), h('span', { class: 'on-desk' }, h('strong', {}, `Shift ${shift.id} `)), statusStampOnDesk(shift.status));
  setText('shift-task', shift.task);

  fill(byId('report'),
    shift.note ? h('p', { class: 'note-box' }, shift.note) : h('p', { class: 'empty' }, 'No report yet.'),
    shift.summary ? h('p', { 'data-mt': '12' }, shift.summary) : null,
    h('div', { class: 'btn-row', 'data-mt': '8' }, ...labels(shift)));

  const gate = byId('gate');
  if (detail.gate.length === 0) {
    fill(gate, h('tr', {}, h('td', { colspan: '4', class: 'empty' }, 'Nothing yet.')));
  } else {
    fill(gate, ...detail.gate.map((g) =>
      h('tr', {},
        h('td', {}, g.attempt),
        h('td', {}, g.stage),
        h('td', {}, h('span', { class: `stamp ${g.status === 'pass' ? 'good' : 'bad'}` }, g.status)),
        h('td', { class: 'break' }, g.detail ?? ''))));
  }

  const shots = byId('shots');
  byId('shots-section').hidden = detail.shots.length === 0;
  fill(shots, ...['before', 'after'].filter((k) => detail.shots.includes(k)).map((kind) =>
    h('figure', {},
      h('img', { class: 'card-img', src: `/api/shifts/${shift.id}/shot/${kind}.png`, alt: `The game ${kind} this shift`, width: '1280', height: '800', loading: 'lazy' }),
      h('figcaption', {}, kind))));

  const link = (url: string | null, text: string): HTMLElement | null => (url ? h('a', { href: url }, text) : null);
  const commit = shift.commit ? `${detail.repos.game}/commit/${shift.commit}` : null;
  fill(byId('facts'), h('table', {}, h('tbody', {},
    row('Started', when(shift.startedAt)),
    row('Ended', shift.endedAt ? when(shift.endedAt) : 'still open'),
    row('From', shift.kind === 'intern' ? "the intern's own backlog" : shift.proposer),
    row('Votes', detail.votes ? `${detail.votes.counted} counted of ${detail.votes.total}` : null),
    row('Tries', String(shift.attempt)),
    row('Version', shift.version ? `v${shift.version}` : null),
    row('Change', shift.filesChanged === null ? null : `${shift.filesChanged} files, +${shift.linesAdded ?? 0} -${shift.linesRemoved ?? 0}`),
    row('Diff', link(shift.diffUrl, 'See the diff')),
    row('Commit', link(commit, shift.commit?.slice(0, 7) ?? '')),
    row('Gate run', link(shift.runUrl, 'See the run')),
  )));

  const card = byId<HTMLImageElement>('card');
  card.alt = `Ship card for shift ${shift.id}: ${shift.task}, ${shift.status}`;
  card.src = `/api/shifts/${shift.id}/card.png`;
  byId<HTMLTextAreaElement>('post').value = postText(shift);
}

function statusStampOnDesk(status: string): HTMLElement {
  const stamp = statusStamp(status);
  stamp.classList.add('sheet-free');
  return stamp;
}

byId('copy-post').addEventListener('click', () => {
  void navigator.clipboard.writeText(byId<HTMLTextAreaElement>('post').value).then(() => setText('copy-post', 'Copied'));
});

void initChrome();
poll(async () => render(await get<Detail>(`/api/shifts/${id}`)), () => 10_000);
