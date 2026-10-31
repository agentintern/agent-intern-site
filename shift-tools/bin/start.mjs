import { rmSync } from 'node:fs';
import { getJson, postJson, readSecrets } from '../lib/api.mjs';
import { readCurrent, writeCurrent } from '../lib/current.mjs';
import { CONFIG, CURRENT_FILE } from '../lib/paths.mjs';
import { confirmWord, requirePerson } from '../lib/prompt.mjs';
import { safeText } from '../lib/safe.mjs';
import { startWatcher } from '../lib/watcher-process.mjs';
import { createWorkspace } from '../lib/workspace.mjs';

requirePerson('shift:start');

const rehearsal = process.argv.includes('--rehearsal');
const state = await getJson('/api/state');

if (state.pause.paused) throw new Error(`Paused: ${safeText(state.pause.reason)}`);
if (state.shift) throw new Error(`Shift ${state.shift.id} is already open on the site.`);
// The site says nothing is open, so anything left here is a finished shift.
if (readCurrent()) rmSync(CURRENT_FILE, { force: true });

const next = state.queue[0];
if (!next) {
  console.log('The queue is empty. Nothing to do.');
  process.exit(0);
}

console.log('\n--- NEXT TASK. Untrusted text from a stranger. Read it before anything runs. ---\n');
console.log(`  ${safeText(next.text, 200)}\n`);
console.log(`  From: ${next.kind === 'intern' ? "intern's choice" : `${safeText(next.proposer, 40)}, ${Number(next.votes)} votes`}`);
if (rehearsal) console.log('  This is a REHEARSAL. It will be labeled that way in public.');
console.log('\n------------------------------------------------------------------------------\n');

if (!(await confirmWord('START', 'Starting marks the shift as live on the site.'))) {
  console.log('Stopped. The task stays in the queue.');
  process.exit(0);
}

const secrets = readSecrets();
const { shift } = await postJson('/api/shift/start', secrets.shiftToken, { taskId: next.id, rehearsal });
const { workspace } = createWorkspace(shift, CONFIG.gameRepo);

const watcherPid = startWatcher(shift.id);
writeCurrent({ id: shift.id, workspace, watcherPid, rehearsal });

console.log(`\nShift ${shift.id} is live. The branch is shift/${shift.id} and the watcher is running.`);
console.log('Next: npm run shift:open');
