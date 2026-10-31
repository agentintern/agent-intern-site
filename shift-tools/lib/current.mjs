import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CURRENT_FILE } from './paths.mjs';

export function readCurrent() {
  return existsSync(CURRENT_FILE) ? JSON.parse(readFileSync(CURRENT_FILE, 'utf8')) : null;
}

export function writeCurrent(value) {
  writeFileSync(CURRENT_FILE, JSON.stringify(value, null, 2), { mode: 0o600 });
}

export function requireCurrent() {
  const current = readCurrent();
  if (!current) throw new Error('No shift is open here. Start one with npm run shift:start.');
  return current;
}
