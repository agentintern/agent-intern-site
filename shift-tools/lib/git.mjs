import { execFileSync } from 'node:child_process';

// A clean environment for every git call: no user config, no system config, and no hooks.
export function gitEnv(extra = {}) {
  const { PATH, HOME, SSH_AUTH_SOCK } = process.env;
  return {
    PATH,
    HOME,
    ...(SSH_AUTH_SOCK ? { SSH_AUTH_SOCK } : {}),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    ...extra,
  };
}

export function git(cwd, args, { env = {}, input } = {}) {
  return execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'protocol.file.allow=always', ...args],
    { cwd, env: gitEnv(env), input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
