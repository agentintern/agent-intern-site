import { get } from './api';
import { initChrome } from './chrome';
import { byId, fill, h, poll, when } from './dom';

interface Entry {
  id: number;
  version: string | null;
  commitSha: string | null;
  at: number | null;
  task: string;
  kind: string;
  proposer: string | null;
  handEdited: number;
  rehearsal: number;
}

async function load(): Promise<void> {
  const { entries, repos } = await get<{ entries: Entry[]; repos: { game: string } }>('/api/changelog');
  const list = byId('entries');
  if (entries.length === 0) {
    fill(list, h('li', { class: 'empty' }, 'v0.1.0: the first day on the job. Nothing has shipped since.'));
    return;
  }
  fill(list, ...entries.map((entry) =>
    h('li', {},
      h('span', {}, entry.task),
      h('span', { class: 'count' }, entry.version ? `v${entry.version}` : ''),
      h('span', { class: 'meta' },
        h('a', { href: `/shift/${entry.id}` }, `Shift ${entry.id}`),
        `, ${when(entry.at)}, `,
        entry.kind === 'intern' ? "intern's choice" : `by ${entry.proposer ?? 'unknown'}`,
        entry.commitSha ? ', ' : '',
        entry.commitSha ? h('a', { href: `${repos.game}/commit/${entry.commitSha}` }, entry.commitSha.slice(0, 7)) : null,
        entry.handEdited ? ', hand-edited by a person' : '',
        entry.rehearsal ? ', rehearsal' : '',
      ))));
}

void initChrome();
poll(load, () => 60_000);
