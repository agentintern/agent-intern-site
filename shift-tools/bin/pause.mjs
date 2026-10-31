import { postJson, readSecrets } from '../lib/api.mjs';
import { requirePerson } from '../lib/prompt.mjs';

requirePerson('shift:pause');

const reason = process.argv.slice(2).join(' ').trim();
const result = await postJson('/api/shift/pause', readSecrets().shiftToken, { reason });
console.log(result.paused ? `Paused: ${result.reason}` : 'Voting and shifts are back on.');
