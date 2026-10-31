import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { containerArgs, ensureImages, openSession, startNetwork, stopNetwork } from '../lib/docker.mjs';
import { HOME } from '../lib/paths.mjs';
import { requirePerson } from '../lib/prompt.mjs';

// Logs Claude Code in to the container's login volume, so a shift finds it ready. This isn't a shift: the
// folder is empty, there's no task and no game, and the site is never told. It's the same container as a shift.
requirePerson('shift:login');

const dir = join(HOME, 'login');
const workspace = join(dir, 'workspace');
const taskFile = join(dir, 'TASK.md');
mkdirSync(workspace, { recursive: true, mode: 0o700 });
// Docker needs the file to exist in the folder too, or it can't mount the read-only copy over it.
for (const file of [taskFile, join(workspace, 'TASK.md')]) writeFileSync(file, 'There is no task. This session is only for logging in.\n');

ensureImages();
startNetwork();
let code = 1;
try {
  console.log('\nOpening the container with an empty folder. Accept the trust prompt, type /login, then /exit.\n');
  code = openSession(containerArgs({ workspace, taskFile }));
} finally {
  stopNetwork();
}
console.log('\nSession closed. No shift was opened.');
process.exit(code);
