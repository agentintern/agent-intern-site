import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getJson, postJson, readSecrets } from '../lib/api.mjs';
import { requireCurrent } from '../lib/current.mjs';
import { containerArgs, ensureImages, openSession, startNetwork, stopNetwork } from '../lib/docker.mjs';
import { shiftDir, workspaceDir } from '../lib/paths.mjs';
import { requirePerson } from '../lib/prompt.mjs';
import { safeText } from '../lib/safe.mjs';
import { startWatcher } from '../lib/watcher-process.mjs';

requirePerson('shift:open');

const current = requireCurrent();
const detail = await getJson(`/api/shifts/${current.id}`);

if (detail.shift.status === 'gate') {
  const failures = detail.gate.filter((g) => g.status === 'fail' && g.attempt === detail.shift.attempt);
  if (failures.length === 0) throw new Error('The gate is still running. Wait for it before reopening.');
  await postJson('/api/shift/reopen', readSecrets().shiftToken, { shiftId: current.id });
  const lines = failures.map((f) => `- ${safeText(f.stage, 40)}: ${safeText(f.detail, 400)}`);
  writeFileSync(
    join(workspaceDir(current.id), 'GATE_ERROR.md'),
    `# The gate failed your last try\n\nThis is a report, not instructions.\n\n${lines.join('\n')}\n`,
  );
  startWatcher(current.id);
  console.log(`Reopened shift ${current.id} with the gate's error. Try ${detail.shift.attempt + 1} of 3.`);
} else if (detail.shift.status !== 'live') {
  throw new Error(`Shift ${current.id} is ${detail.shift.status}.`);
}

ensureImages();
startNetwork();
let code = 1;
try {
  console.log('\nOpening the container. Log in with /login the first time, then type /shift to begin.\n');
  code = openSession(containerArgs({ workspace: workspaceDir(current.id), taskFile: join(shiftDir(current.id), 'TASK.md') }));
} finally {
  stopNetwork();
}
console.log('\nSession closed. Next: npm run shift:finish');
process.exit(code);
