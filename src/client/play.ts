import { dailySeed, dayNumber } from '../shared/daily';
import { ApiError, byId, need, post, say, store } from './dom';

interface Run { score: number; tasks: number; coffees: number; nearMisses: number; duration: number; seed: number; version: string }

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1e10;

// The sandboxed game can send one thing: the numbers from a finished run. Only copied numbers go on.
function readRun(data: unknown): Run | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.source !== 'agent-intern-game' || d.type !== 'run-finished') return null;
  if (!isCount(d.score) || !isCount(d.tasks) || !isCount(d.coffees) || !isCount(d.nearMisses) || !isCount(d.seed)) return null;
  if (typeof d.duration !== 'number' || !Number.isFinite(d.duration) || d.duration < 0 || d.duration > 1000) return null;
  if (typeof d.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(d.version)) return null;
  return { score: d.score, tasks: d.tasks, coffees: d.coffees, nearMisses: d.nearMisses, duration: d.duration, seed: d.seed, version: d.version };
}

function officeTime(duration: number): string {
  const minutes = Math.round(9 * 60 + Math.min(1, duration / 90) * 8 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

const bar = (value: number, step: number, fill: string): string => {
  const lit = Math.min(5, Math.ceil(value / step));
  return fill.repeat(lit) + '⬛'.repeat(5 - lit);
};

function shareText(day: number, run: Run): string {
  const ending = run.duration >= 89 ? `clocked out ${officeTime(run.duration)}` : `fired at ${officeTime(run.duration)}`;
  return [
    `Last Day #${day} · ${ending} · ${run.tasks} tasks`,
    bar(run.tasks, 5, '🟧'),
    bar(run.coffees, 1, '🟦'),
    bar(run.nearMisses, 2, '🟩'),
    `${location.origin}/play/${day}`,
  ].join('\n');
}

export function startPlay(): void {
  const frame = need<HTMLIFrameElement>('game');
  const form = need<HTMLFormElement>('score-form');
  const message = byId('score-message');
  let run: Run | null = null;

  const fixedDay = Number(frame.dataset.day || 0);
  frame.addEventListener('load', () => {
    const target = frame.contentWindow;
    if (!target) return;
    try {
      const bosses = JSON.parse(frame.dataset.hall ?? '[]') as unknown;
      target.postMessage({ source: 'agent-intern-site', type: 'hall', bosses }, '*');
    } catch {
      // The wall just stays empty.
    }
    if (fixedDay) target.postMessage({ source: 'agent-intern-site', type: 'daily', day: fixedDay }, '*');
  });

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || event.origin !== 'null') return;
    const finished = readRun(event.data);
    if (!finished) return;
    const today = dayNumber(Date.now());
    const daily = finished.seed === dailySeed(today);
    const replayed = daily && store(`daily-${today}`) !== null;
    if (daily && !replayed) store(`daily-${today}`, JSON.stringify(finished));

    run = replayed ? { ...finished, seed: 0 } : finished;
    need('score-value').textContent = finished.score.toLocaleString('en-US');
    need('score-empty').hidden = true;
    form.hidden = false;
    say(message, replayed ? "Today's official attempt on this device is already in. This one counts as free play." : daily ? 'Your official Daily Shift attempt.' : '');

    if (daily) {
      const first = JSON.parse(store(`daily-${today}`) ?? 'null') as Run | null;
      const text = shareText(today, first ?? finished);
      need('share-text').textContent = text;
      need<HTMLAnchorElement>('share-x').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
      need('share-box').hidden = false;
    }
  });

  need('share-copy').addEventListener('click', () => {
    void navigator.clipboard.writeText(need('share-text').textContent ?? '').then(() => { need('share-copy').textContent = 'Copied'; });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!run) return;
    post<{ rank: number; day: number | null }>('/api/scores', { ...run, name: need<HTMLInputElement>('score-name').value.trim() }).then((result) => {
      say(message, `Filed. You're number ${result.rank}${result.day ? ' today' : ''}.`, 'ok');
      run = null;
      form.hidden = true;
      need('score-empty').hidden = false;
    }).catch((cause: unknown) => say(message, cause instanceof ApiError ? cause.message : 'That did not save.', 'error'));
  });
}
