import { get, type Shift } from './api';
import { initChrome } from './chrome';
import { byId, fill, h, poll, when } from './dom';
import { labels, statusStamp } from './stamps';

async function load(): Promise<void> {
  const { shifts } = await get<{ shifts: Shift[] }>('/api/shifts');
  const body = byId('shifts');
  if (shifts.length === 0) {
    fill(body, h('tr', {}, h('td', { colspan: '5', class: 'empty' }, 'No shifts yet. The intern just got its badge.')));
    return;
  }
  fill(body, ...shifts.map((shift) =>
    h('tr', {},
      h('td', {}, h('a', { href: `/shift/${shift.id}` }, `#${shift.id}`)),
      h('td', {}, shift.task, h('div', { class: 'btn-row' }, ...labels(shift))),
      h('td', {}, statusStamp(shift.status)),
      h('td', {}, shift.version ? `v${shift.version}` : ''),
      h('td', {}, when(shift.startedAt)),
    )));
}

void initChrome();
poll(load, () => 30_000);
