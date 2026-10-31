import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

// Everything a shift touches lives here, outside every repo. Only workspace/ reaches the container.
export const HOME = process.env.AGENT_INTERN_HOME || join(homedir(), '.agent-intern');
export const SECRETS_FILE = join(HOME, 'secrets.json');
export const PUSH_KEY = join(HOME, 'push_key');
export const CURRENT_FILE = join(HOME, 'current.json');

export function shiftDir(id) {
  return join(HOME, 'shifts', String(id));
}
export const workspaceDir = (id) => join(shiftDir(id), 'workspace');
export const hostRepoDir = (id) => join(shiftDir(id), 'host-repo');
