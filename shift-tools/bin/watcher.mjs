import { watch, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { postJson, readSecrets } from '../lib/api.mjs';
import { CONFIG, shiftDir, workspaceDir } from '../lib/paths.mjs';
import { fileEvent, readTestCounts, readTestState, StateMachine } from '../lib/watch-logic.mjs';

const shiftId = Number(process.argv[2]);
if (!Number.isInteger(shiftId)) throw new Error('usage: watcher.mjs <shift id>');

// The watcher never starts anything. It reports on a shift a person already opened, then exits.
const MAX_LIFETIME_MS = 12 * 60 * 60 * 1000;
const DEBOUNCE_MS = 700;
const TICK_MS = 15_000;

const { watcherToken } = readSecrets();
const workspace = workspaceDir(shiftId);
const stopFile = join(shiftDir(shiftId), 'stop');
const machine = new StateMachine(CONFIG.stuckMinutes * 60_000);
const startedAt = Date.now();
const pending = new Map();

async function send(event) {
  if (!event) return;
  try {
    await postJson('/api/live/event', watcherToken, { shiftId, ...event });
  } catch (cause) {
    console.log(`send failed: ${cause.message}`);
    if (/over/.test(cause.message)) process.exit(0);
  }
}

async function onTestFile(name) {
  if (name === 'state.json') {
    const state = readTestState(join(workspace, '.shift', 'state.json'));
    if (state === 'testing') await send(machine.testsStarted());
  }
  if (name === 'test-results.json') {
    const counts = readTestCounts(join(workspace, '.shift', 'test-results.json'));
    if (counts) await send({ kind: 'test', ...counts });
    await send(machine.testsFinished(counts));
  }
}

async function flush(path) {
  pending.delete(path);
  const change = existsSync(join(workspace, path)) ? 'changed' : 'removed';
  const event = fileEvent(path, change);
  if (!event) return;
  await send(event);
  await send(machine.fileChanged());
}

watch(workspace, { recursive: true }, (_kind, filename) => {
  if (!filename) return;
  const path = relative(workspace, join(workspace, filename.toString())).split(sep).join('/');
  if (path.startsWith('.shift/')) {
    void onTestFile(path.slice('.shift/'.length));
    return;
  }
  clearTimeout(pending.get(path));
  pending.set(path, setTimeout(() => void flush(path), DEBOUNCE_MS));
});

setInterval(() => {
  if (existsSync(stopFile) || Date.now() - startedAt > MAX_LIFETIME_MS) process.exit(0);
  void send(machine.tick());
}, TICK_MS);

console.log(`watching shift ${shiftId}`);
