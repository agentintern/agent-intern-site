import { getJson } from '../lib/api.mjs';
import { readCurrent } from '../lib/current.mjs';
import { safeText } from '../lib/safe.mjs';

const state = await getJson('/api/state');
const current = readCurrent();
console.log(`Mode: ${state.config.mode}`);
console.log(`Paused: ${state.pause.paused ? safeText(state.pause.reason) : 'no'}`);
console.log(`Round ${state.round.id}: ${state.round.status}, closes ${new Date(state.round.closesAt).toISOString()}`);
console.log(`On shift: ${state.shift ? `shift ${state.shift.id} (${state.shift.state})` : 'no'}`);
console.log(`Open here: ${current ? `shift ${current.id}` : 'none'}`);
console.log(`Queue: ${state.queue.length}`);
for (const task of state.queue.slice(0, 5)) console.log(`  - ${safeText(task.text, 100)}`);
