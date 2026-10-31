import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './paths.mjs';

export const INTERN_IMAGE = 'agent-intern-shift:1';
export const PROXY_IMAGE = 'agent-intern-proxy:1';
export const SHIFT_NETWORK = 'agent-intern-shift';
export const EGRESS_NETWORK = 'agent-intern-egress';
export const PROXY_NAME = 'agent-intern-proxy';
export const LOGIN_VOLUME = 'agent-intern-claude-login';

function docker(args, { quiet = true } = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
}

function exists(kind, name) {
  return spawnSync('docker', [kind, 'inspect', name], { stdio: 'ignore' }).status === 0;
}

export function ensureImages({ rebuild = false } = {}) {
  const context = join(ROOT, 'docker');
  if (rebuild || !exists('image', PROXY_IMAGE)) {
    docker(['build', '-q', '-t', PROXY_IMAGE, '-f', join(context, 'proxy.Dockerfile'), context]);
  }
  if (rebuild || !exists('image', INTERN_IMAGE)) {
    docker(['build', '-t', INTERN_IMAGE, '-f', join(context, 'intern.Dockerfile'), context], { quiet: false });
  }
}

// The shift network is internal: it has no route out at all. The only thing on it that can reach
// anything else is the proxy, and the proxy only speaks to the names on its allowlist.
export function startNetwork() {
  if (!exists('network', SHIFT_NETWORK)) docker(['network', 'create', '--internal', SHIFT_NETWORK]);
  if (!exists('network', EGRESS_NETWORK)) docker(['network', 'create', EGRESS_NETWORK]);
  spawnSync('docker', ['rm', '-f', PROXY_NAME], { stdio: 'ignore' });
  docker([
    'run', '-d', '--name', PROXY_NAME, '--network', EGRESS_NETWORK,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '64', '--memory', '128m', PROXY_IMAGE,
  ]);
  docker(['network', 'connect', '--alias', 'proxy', SHIFT_NETWORK, PROXY_NAME]);
}

export function stopNetwork() {
  spawnSync('docker', ['rm', '-f', PROXY_NAME], { stdio: 'ignore' });
}

// The one place the container's powers are decided. The container test runs these exact arguments.
export function containerArgs({ workspace, taskFile, name = 'agent-intern-shift-session' }) {
  return [
    '--rm',
    '--name', name,
    '--network', SHIFT_NETWORK,
    '--dns', '127.0.0.1',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--read-only',
    '--pids-limit', '512',
    '--memory', '4g',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=1g',
    '--tmpfs', '/home/intern:rw,nosuid,nodev,uid=1001,gid=1001,mode=700,size=1g',
    '--mount', `type=volume,source=${LOGIN_VOLUME},target=/home/intern/.claude`,
    '--mount', `type=bind,source=${workspace},target=/workspace`,
    '--mount', `type=bind,source=${taskFile},target=/workspace/TASK.md,readonly`,
    '-e', 'HOME=/home/intern',
    '-e', 'CLAUDE_CONFIG_DIR=/home/intern/.claude',
    '-e', 'HTTPS_PROXY=http://proxy:3128',
    '-e', 'https_proxy=http://proxy:3128',
    '-e', 'HTTP_PROXY=http://proxy:3128',
    '-e', 'http_proxy=http://proxy:3128',
    '-e', 'NO_PROXY=localhost,127.0.0.1',
    '-e', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
    '-e', 'DISABLE_AUTOUPDATER=1',
    '-e', 'CLAUDE_CODE_DISABLE_ARTIFACT=1',
    '-e', 'ENABLE_CLAUDEAI_MCP_SERVERS=false',
  ];
}

export function openSession(args) {
  // A session left open from an earlier try would block the name. A person just asked for a new one.
  spawnSync('docker', ['rm', '-f', 'agent-intern-shift-session'], { stdio: 'ignore' });
  return spawnSync('docker', ['run', '-it', ...args, INTERN_IMAGE], { stdio: 'inherit' }).status ?? 1;
}
