import { readCurrent, writeCurrent } from '../lib/current.mjs';
import { getJson, postJson, readSecrets } from '../lib/api.mjs';
import { CONFIG } from '../lib/paths.mjs';
import { confirmWord, requirePerson } from '../lib/prompt.mjs';
import { safeText } from '../lib/safe.mjs';
import { createWorkspace } from '../lib/workspace.mjs';

// A change by the people running the project, outside the queue. It's labeled TEAM CHANGE in public,
// it takes the same gate, and it never counts as intern work. No model is started here.
requirePerson('shift:team');

const text = process.argv.slice(2).join(' ').trim();
if (!text) throw new Error('usage: npm run shift:team -- what this change does');
const state = await getJson('/api/state');
if (state.shift) throw new Error(`Shift ${state.shift.id} is already open on the site.`);
if (readCurrent()) console.log('Replacing the record of a finished shift.');

console.log(`\nTeam change: ${safeText(text, 120)}\n`);
if (!(await confirmWord('START', 'This opens a shift labeled TEAM CHANGE on the site.'))) process.exit(0);

const { shift } = await postJson('/api/shift/team', readSecrets().shiftToken, { text });
const { workspace } = createWorkspace(shift, CONFIG.gameRepo);
writeCurrent({ id: shift.id, workspace, team: true });
console.log(`\nShift ${shift.id} is open as a team change. Work in ${workspace}, write RESULT.json, then npm run shift:finish`);
