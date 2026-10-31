import type { Shift } from './api';
import { h } from './dom';

const STAMPS: Record<string, [string, string]> = {
  live: ['on shift', 'note'],
  gate: ['at the gate', 'note'],
  shipped: ['shipped', 'good'],
  refused: ['refused', 'bad'],
  failed: ['failed', 'bad'],
  'rolled-back': ['rolled back', 'bad'],
};

export function statusStamp(status: string): HTMLElement {
  const [label, tone] = STAMPS[status] ?? [status, ''];
  return h('span', { class: `stamp ${tone}` }, label);
}

export function labels(shift: Pick<Shift, 'handEdited' | 'rehearsal' | 'kind'>): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (shift.rehearsal) out.push(h('span', { class: 'stamp note' }, 'rehearsal'));
  if (shift.handEdited) out.push(h('span', { class: 'stamp note' }, 'hand-edited by a person'));
  if (shift.kind === 'intern') out.push(h('span', { class: 'stamp' }, "intern's choice"));
  return out;
}
