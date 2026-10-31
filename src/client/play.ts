import { ApiError, get, post } from './api';
import { initChrome } from './chrome';
import { byId, fill, h, poll } from './dom';

interface Run {
  score: number;
  tasks: number;
  coffees: number;
  nearMisses: number;
  duration: number;
  seed: number;
  version: string;
}

interface Row {
  name: string;
  score: number;
  version: string;
}

const frame = byId<HTMLIFrameElement>('game');
const form = byId<HTMLFormElement>('score-form');
const message = byId('score-message');
let run: Run | null = null;

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1e7;

// The sandboxed game can send one thing: the numbers from a finished run. Anything that isn't
// exactly that shape, from exactly that frame, is dropped. Only copied numbers go any further.
function readRun(data: unknown): Run | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.source !== 'agent-intern-game' || d.type !== 'run-finished') return null;
  if (!isCount(d.score) || !isCount(d.tasks) || !isCount(d.coffees) || !isCount(d.nearMisses) || !isCount(d.seed)) return null;
  if (typeof d.duration !== 'number' || !Number.isFinite(d.duration) || d.duration < 0 || d.duration > 1000) return null;
  if (typeof d.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(d.version)) return null;
  return { score: d.score, tasks: d.tasks, coffees: d.coffees, nearMisses: d.nearMisses, duration: d.duration, seed: d.seed, version: d.version };
}

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.origin !== 'null') return;
  const finished = readRun(event.data);
  if (!finished) return;
  run = finished;
  byId('score-value').textContent = finished.score.toLocaleString('en-US');
  byId('score-empty').hidden = true;
  form.hidden = false;
  message.textContent = '';
  message.className = '';
});

async function loadBoard(fresh = false): Promise<void> {
  const { scores } = await get<{ scores: Row[] }>('/api/leaderboard', fresh);
  const list = byId('leaderboard');
  if (scores.length === 0) {
    fill(list, h('li', { class: 'empty' }, 'Nobody yet. The desk is yours.'));
    return;
  }
  fill(list, ...scores.slice(0, 10).map((row, i) =>
    h('li', {},
      h('span', {}, `${i + 1}. ${row.name}`),
      h('span', { class: 'count' }, row.score.toLocaleString('en-US')),
    )));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!run) return;
  const name = (byId<HTMLInputElement>('score-name')).value.trim();
  const body = { ...run, name };
  post<{ rank: number }>('/api/scores', body).then((result) => {
    message.textContent = `Filed. You're number ${result.rank}.`;
    message.className = 'ok';
    run = null;
    form.hidden = true;
    byId('score-empty').hidden = false;
    return loadBoard(true);
  }).catch((cause: unknown) => {
    message.textContent = cause instanceof ApiError ? cause.message : 'That did not save.';
    message.className = 'error';
    form.hidden = false;
  });
});

void initChrome();
poll(() => loadBoard(), () => 120_000);
