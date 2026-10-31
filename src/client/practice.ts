import { ApiError, byId, h, need, post, say, store } from './dom';

interface Verdict { verdict: 'open' | 'rejected' | 'held'; reason: string | null; by?: string }
interface Note { text: string; votes: number }

const KEY = 'practice-board';

// Practice tasks live in this browser and nowhere else. The only server call is the screening check.
export function startPractice(): void {
  const form = need<HTMLFormElement>('practice-form');
  const input = need<HTMLTextAreaElement>('practice-text');
  const message = byId('practice-message');
  const list = byId<HTMLOListElement>('practice-list');
  let notes: Note[] = [];

  const render = (): void => {
    if (!list) return;
    list.replaceChildren(...notes.map((note, i) => {
      const vote = h('button', { class: 'btn small ghost', type: 'button' }, 'Practice vote');
      vote.addEventListener('click', () => { note.votes = note.votes ? 0 : 1; notes.forEach((n, j) => { if (j !== i) n.votes = 0; }); save(); render(); });
      return h('li', { class: 'sheet-note' }, h('span', {}, note.text), h('span', { class: 'note-foot' }, note.votes ? 'your practice vote' : ''), vote);
    }));
  };
  const save = (): void => { store(KEY, JSON.stringify(notes)); };

  if (list) {
    const saved = store(KEY);
    notes = saved ? (JSON.parse(saved) as Note[]) : [...list.querySelectorAll('li')].map((li) => ({ text: li.textContent ?? '', votes: 0 }));
    render();
    byId('practice-close')?.addEventListener('click', () => {
      const winner = notes.find((n) => n.votes > 0);
      say(byId('practice-result'), winner ? `Practice result: "${winner.text}" would join the queue. In a real round, balances are read again first.` : 'No practice votes. In a real round, the intern would pick from its own backlog.', 'ok');
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    say(message, 'Screening...');
    post<Verdict>('/api/practice/check', { text }).then((result) => {
      if (result.verdict === 'open') {
        say(message, list ? 'It passed screening and landed in your practice in-tray.' : 'It got through screening. On the real board it could be voted on, and the person starting the shift and the intern would still read it. The gate would still check the result.', 'ok');
        if (list) { notes.unshift({ text, votes: 0 }); save(); render(); input.value = ''; }
      } else {
        say(message, result.reason ?? 'It was held.', result.verdict === 'rejected' ? 'error' : '');
      }
    }).catch((cause: unknown) => say(message, cause instanceof ApiError ? cause.message : 'That did not work.', 'error'));
  });
}
