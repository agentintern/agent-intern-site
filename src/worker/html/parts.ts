import { robotSvg, type RobotState } from '../../shared/robot';
import type { ProposalRow } from '../board';
import { threshold } from '../config';
import { type QueueTask, type Overview } from '../public';
import { WORK_LABELS, type ShiftRow } from '../shifts';
import { html, raw, shortAddress, when, type Safe } from './core';

const STAMPS: Record<string, [string, string]> = {
  live: ['On shift', 'note'],
  gate: ['At the gate', 'note'],
  shipped: ['Shipped', 'good'],
  refused: ['Refused', 'bad'],
  failed: ['Failed', 'bad'],
  'rolled-back': ['Rolled back', 'bad'],
};

export function stamp(status: string): Safe {
  const [label, tone] = STAMPS[status] ?? [status, ''];
  return html`<span class="stamp ${tone}">${label}</span>`;
}

export function workLabel(workedBy: string): Safe {
  const label = WORK_LABELS[workedBy] ?? { label: workedBy, meaning: '' };
  return html`<span class="work work-${workedBy}" title="${label.meaning}">${label.label}</span>`;
}

export function robotFor(open: ShiftRow | null, last: ShiftRow | null, paused: boolean): RobotState {
  if (open) {
    if (open.state === 'writing' || open.state === 'gate') return 'working';
    if (open.state === 'stuck') return 'stuck';
    return 'thinking';
  }
  if (paused) return 'asleep';
  if (last?.ended_at && Date.now() - last.ended_at < 3_600_000 && last.worked_by === 'intern') {
    if (last.status === 'shipped') return 'celebrating';
    if (last.status === 'refused') return 'refusing';
    if (last.status === 'failed' || last.status === 'rolled-back') return 'panicking';
  }
  return 'asleep';
}

export const STATE_WORDS: Record<string, string> = {
  reading: 'reading the task',
  writing: 'writing',
  testing: 'testing',
  stuck: 'stuck',
  gate: 'at the gate',
};

export function shiftLine(o: Pick<Overview, 'open' | 'pause'>): { label: string; on: boolean; paused: string | null } {
  return {
    label: o.pause.paused ? 'paused' : o.open ? `on shift: ${STATE_WORDS[o.open.state] ?? o.open.state}` : 'off shift',
    on: Boolean(o.open),
    paused: o.pause.paused ? o.pause.reason ?? 'no reason given' : null,
  };
}

export function punchClock(closesAt: number, label = 'Vote closes in'): Safe {
  const left = Math.max(0, closesAt - Date.now());
  const pad = (n: number): string => String(n).padStart(2, '0');
  const total = Math.floor(left / 1000);
  const text = `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  return html`<div class="punch" role="timer" aria-label="${label}"><span class="punch-label">${label}</span><b data-countdown="${closesAt}">${text}</b><span class="punch-card">closes ${when(closesAt)}</span></div>`;
}

export function inTray(proposals: ProposalRow[], limit = 5): Safe {
  const open = proposals.filter((p) => p.status === 'open').slice(0, limit);
  if (open.length === 0) return html`<p class="empty">The in-tray is empty. Somebody has to be the boss today.</p>`;
  return html`<ol class="tray">${open.map((task, i) => html`
<li class="sheet-note n${i % 3}"><a href="/task/${task.id}">${task.text}</a><span class="note-foot"><b>${task.votes}</b> ${task.votes === 1 ? 'vote' : 'votes'} · by <a href="/boss/${task.wallet}">${shortAddress(task.wallet)}</a></span></li>`)}</ol>`;
}

export function whiteboard(queue: QueueTask[]): Safe {
  if (queue.length === 0) return html`<p class="empty marker">Nothing on the board. The next winner goes here.</p>`;
  return html`<ol class="queue">${queue.slice(0, 8).map((task, i) => html`
<li><span class="marker-num">${i + 1}</span><span>${task.text}</span><small>${task.kind === 'intern' ? "intern's choice" : `by ${task.proposer ?? 'unknown'}, ${task.votes} votes`}</small></li>`)}</ol>`;
}

export function shiftRow(shift: { id: number; status: string; worked_by: string; task_text: string; version: string | null; started_at: number }): Safe {
  return html`<li class="drawer">
<a class="drawer-tab" href="/shift/${shift.id}">Shift ${shift.id}</a>
<div class="drawer-body"><a href="/shift/${shift.id}">${shift.task_text}</a><small>${when(shift.started_at)}${shift.version ? ` · v${shift.version}` : ''}</small></div>
<div class="drawer-marks">${workLabel(shift.worked_by)}${stamp(shift.status)}</div>
</li>`;
}

export function passLine(): string {
  return threshold().toLocaleString('en-US');
}

export function robotPanel(state: RobotState, label: string): Safe {
  return raw(robotSvg(state, label));
}
