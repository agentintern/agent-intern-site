import { get, type State } from './api';
import { initChrome, showShiftPill } from './chrome';
import { Desk, moodFor, STATE_WORDS } from './desk';
import { byId, countdown, fill, h, poll, setText } from './dom';
import { renderQueue } from './queue';

const desk = new Desk(byId<HTMLCanvasElement>('desk'));
let closesAt = 0;

function render(state: State): void {
  showShiftPill(state.shift, state.pause);
  closesAt = state.round.closesAt;
  const mood = moodFor(state.shift?.state, state.pause.paused);
  desk.setMood(mood);
  setText('desk-state', state.shift ? `on shift: ${STATE_WORDS[mood] ?? mood}` : STATE_WORDS[mood] ?? 'off shift');
  setText('round-line', state.round.status === 'open'
    ? `Round ${state.round.id}. ${state.top.length} open ${state.top.length === 1 ? 'task' : 'tasks'} so far.`
    : `Round ${state.round.id} is being counted.`);

  const list = byId('top-tasks');
  if (state.top.length === 0) {
    fill(list, h('li', { class: 'empty' }, 'No tasks yet. Be the first boss of the day.'));
  } else {
    fill(list, ...state.top.map((task) =>
      h('li', {},
        h('span', {}, task.text ?? ''),
        h('span', { class: 'count' }, `${task.votes} ${task.votes === 1 ? 'vote' : 'votes'}`),
        h('span', { class: 'meta' }, `by ${task.by}`),
      )));
  }
  renderQueue(state.queue);
}

setInterval(() => {
  if (closesAt) setText('countdown', countdown(closesAt - Date.now()));
}, 1000);

void initChrome();
poll(async () => render(await get<State>('/api/state')), () => 20_000);
