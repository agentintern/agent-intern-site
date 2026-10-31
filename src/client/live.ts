import { get, type Pause, type Shift, type Task } from './api';
import { showMintChip, showShiftPill } from './chrome';
import { Desk, moodFor, STATE_WORDS } from './desk';
import { byId, clockTime, fill, h, poll, setText, timer } from './dom';
import { renderQueue } from './queue';

interface FeedEvent {
  id: number;
  at: number;
  kind: string;
  data: Record<string, unknown>;
}

interface Live {
  onShift: boolean;
  shift: Shift | null;
  last: Shift | null;
  events: FeedEvent[];
  queue: Task[];
  pause: Pause;
}

const desk = new Desk(byId<HTMLCanvasElement>('desk'));
const feed = byId('feed');
let lastId = 0;
let onShift = false;
let current: Shift | null = null;
let lastTestFailed = false;
const seen: HTMLElement[] = [];

function describe(event: FeedEvent): { text: string; tone: string } {
  const d = event.data;
  switch (event.kind) {
    case 'state':
      return { text: `state: ${STATE_WORDS[String(d.state)] ?? String(d.state)}`, tone: 'hl' };
    case 'file':
      return { text: `${String(d.change)} ${String(d.path)}`, tone: '' };
    case 'test': {
      const failed = Number(d.failed);
      return { text: `tests: ${Number(d.passed)} passed, ${failed} failed`, tone: failed > 0 ? 'fail' : 'pass' };
    }
    case 'gate':
      return { text: `gate: ${String(d.stage)} ${String(d.status)}${d.detail ? `, ${String(d.detail)}` : ''}`, tone: d.status === 'pass' ? 'pass' : 'fail' };
    case 'redacted':
      return { text: 'one event removed: it looked like a secret', tone: 'fail' };
    default:
      return { text: event.kind, tone: '' };
  }
}

function append(events: FeedEvent[]): void {
  for (const event of events) {
    if (event.id <= lastId) continue;
    lastId = event.id;
    if (event.kind === 'test') lastTestFailed = Number(event.data.failed) > 0;
    if (event.kind === 'state' && event.data.state === 'reading') lastTestFailed = false;
    const { text, tone } = describe(event);
    const row = h('li', {}, h('time', {}, clockTime(event.at).slice(0, 8)), h('span', { class: tone }, text));
    seen.push(row);
    feed.append(row);
  }
  while (seen.length > 200) seen.shift()?.remove();
  feed.scrollTop = feed.scrollHeight;
}

function render(data: Live): void {
  onShift = data.onShift;
  current = data.shift;
  showShiftPill(data.shift, data.pause);
  const mood = moodFor(data.shift?.state, data.pause.paused, data.last?.status, lastTestFailed);
  desk.setMood(mood);
  setText('desk-state', data.shift ? STATE_WORDS[mood] ?? data.shift.state : data.pause.paused ? 'paused' : 'off shift');
  renderQueue(data.queue);

  const task = byId('current-task');
  if (data.shift) {
    task.textContent = data.shift.task;
    task.className = '';
    setText('current-meta', [
      `Shift ${data.shift.id}`,
      data.shift.kind === 'intern' ? "intern's choice" : `by ${data.shift.proposer ?? 'unknown'}`,
      data.shift.attempt > 1 ? `try ${data.shift.attempt} of 3` : '',
      data.shift.rehearsal ? 'rehearsal' : '',
    ].filter(Boolean).join(', '));
    setText('live-lede', 'A person opened this shift and is at the keyboard.');
  } else {
    task.textContent = data.pause.paused ? `Paused: ${data.pause.reason ?? ''}` : 'Off shift. The queue waits until a person starts the next one.';
    task.className = 'empty';
    fill(byId('current-meta'), data.last
      ? h('a', { href: `/shift/${data.last.id}` }, `Last: shift ${data.last.id}, ${data.last.status}`)
      : 'No shifts yet.');
    setText('live-lede', 'A person starts every shift. When one is open, this page follows it.');
  }
  if (data.events.length > 0 && lastId === 0) fill(feed);
  append(data.events);
}

setInterval(() => {
  setText('timer', current ? timer(Date.now() - current.startedAt) : '--:--');
}, 1000);

// Every poll is a billed request, and a launch is exactly when people watch.
showMintChip();
poll(async () => render(await get<Live>(`/api/live?after=${lastId}`)), () => (onShift ? 10_000 : 60_000));
