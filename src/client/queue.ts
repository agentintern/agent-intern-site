import type { Task } from './api';
import { fill, h, maybeId } from './dom';

export function renderQueue(tasks: Task[]): void {
  const list = maybeId('queue');
  if (!list) return;
  if (tasks.length === 0) {
    fill(list, h('li', { class: 'empty' }, 'Empty. The next winner goes here.'));
    return;
  }
  fill(list, ...tasks.slice(0, 8).map((task, i) =>
    h('li', {},
      h('span', {}, task.text),
      h('span', { class: 'count' }, `#${i + 1}`),
      h('span', { class: 'meta' }, task.kind === 'intern' ? "intern's choice" : `by ${task.proposer ?? 'unknown'}, ${task.votes} votes`),
    )));
}
