import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, shiftDir } from './paths.mjs';

export function startWatcher(shiftId) {
  const dir = shiftDir(shiftId);
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, 'stop'), { force: true });
  const log = openSync(join(dir, 'watcher.log'), 'a');
  const watcher = spawn(process.execPath, [join(ROOT, 'bin/watcher.mjs'), String(shiftId)], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  watcher.unref();
  closeSync(log);
  return watcher.pid;
}
