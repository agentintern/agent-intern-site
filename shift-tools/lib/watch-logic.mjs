import { lstatSync, readFileSync } from 'node:fs';
import { hasSecret } from './redact.mjs';
import { isSafePath } from './safe.mjs';

const IGNORED_ROOTS = new Set(['.git', 'node_modules', 'dist', 'TASK.md', 'GATE_ERROR.md']);
const MAX_STATE_BYTES = 4 * 1024;
const MAX_RESULTS_BYTES = 2 * 1024 * 1024;

// Turns a changed path into what may go public: the event, a redaction notice, or nothing at all.
export function fileEvent(path, change) {
  const root = path.split('/')[0];
  if (IGNORED_ROOTS.has(root) || root === '.shift') return null;
  if (!isSafePath(path) || hasSecret(path)) return { kind: 'redacted' };
  return { kind: 'file', path, change };
}

// These two files are written inside the container. They're read as untrusted input, and only
// a number or one known word survives. A symlink here would point at this machine, so it's refused.
function readSmall(path, limit) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > limit) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function readTestState(path) {
  const value = readSmall(path, MAX_STATE_BYTES);
  return value?.state === 'testing' ? 'testing' : value?.state === 'tested' ? 'tested' : null;
}

export function readTestCounts(path) {
  const value = readSmall(path, MAX_RESULTS_BYTES);
  const passed = value?.numPassedTests;
  const failed = value?.numFailedTests;
  if (!Number.isInteger(passed) || !Number.isInteger(failed) || passed < 0 || failed < 0) return null;
  return { passed, failed };
}

// Decides the public state from activity alone. It never reads the session.
export class StateMachine {
  constructor(stuckMs) {
    this.stuckMs = stuckMs;
    this.state = 'reading';
    this.lastActivity = Date.now();
    this.failStreak = 0;
  }

  move(next) {
    if (next === this.state) return null;
    this.state = next;
    return { kind: 'state', state: next };
  }

  fileChanged(now = Date.now()) {
    this.lastActivity = now;
    return this.state === 'testing' ? null : this.move('writing');
  }

  testsStarted(now = Date.now()) {
    this.lastActivity = now;
    return this.move('testing');
  }

  testsFinished(counts, now = Date.now()) {
    this.lastActivity = now;
    this.failStreak = counts && counts.failed > 0 ? this.failStreak + 1 : 0;
    return this.move(this.failStreak >= 3 ? 'stuck' : 'writing');
  }

  tick(now = Date.now()) {
    return now - this.lastActivity > this.stuckMs ? this.move('stuck') : null;
  }
}
