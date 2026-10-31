import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { containerArgs, DENIED_COMMANDS } from '../lib/docker.mjs';
import { ROOT } from '../lib/paths.mjs';

const run = (script, env = {}) =>
  spawnSync(process.execPath, [join(ROOT, 'bin', script)], {
    input: 'START\nPUSH\ny\n',
    encoding: 'utf8',
    env: { ...process.env, AGENT_INTERN_SITE: 'http://127.0.0.1:9', ...env },
  });

describe('a person starts every shift', () => {
  for (const script of ['start.mjs', 'login.mjs', 'open.mjs', 'finish.mjs', 'pause.mjs', 'team.mjs']) {
    it(`${script} refuses to run without a terminal, even with the answers piped in`, () => {
      const result = run(script);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /needs a person at a real terminal/);
    });
  }

  it('never tells the site or reads a task when it only logs in', () => {
    const login = readFileSync(join(ROOT, 'bin/login.mjs'), 'utf8');
    assert.doesNotMatch(login, /api\.mjs|postJson|getJson|readSecrets|current\.mjs|workspaceDir/);
  });

  it('has no flag that skips the confirmation', () => {
    for (const file of ['bin/start.mjs', 'bin/finish.mjs', 'bin/open.mjs']) {
      assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /--yes|--force|--no-confirm|skipConfirm/);
    }
  });
});

describe('what the container is given', () => {
  const args = containerArgs({ workspace: '/w', taskFile: '/t' });
  const joined = args.join(' ');

  it('passes only named environment variables, and none of them secret', () => {
    const names = args.flatMap((value, i) => (args[i - 1] === '-e' ? [value.split('=')[0]] : []));
    assert.deepEqual(names.filter((n) => /TOKEN|KEY|SECRET|PASSWORD/i.test(n)), []);
    assert.equal(args.includes('--env-file'), false);
  });

  it('mounts only the workspace, the task and the login volume', () => {
    const mounts = args.flatMap((value, i) => (args[i - 1] === '--mount' ? [value] : []));
    assert.deepEqual(mounts, [
      'type=volume,source=agent-intern-claude-login,target=/home/intern/.claude',
      'type=bind,source=/w,target=/workspace',
      'type=bind,source=/t,target=/workspace/TASK.md,readonly',
    ]);
    assert.doesNotMatch(joined, /docker\.sock|\.ssh|-v /);
  });

  it('denies every way to fetch a package, from settings the workspace cannot change', () => {
    const { deny } = JSON.parse(readFileSync(join(ROOT, 'docker/managed-settings.json'), 'utf8')).permissions;
    assert.deepEqual(DENIED_COMMANDS.filter((entry) => !deny.includes(entry)), []);
    assert.equal(DENIED_COMMANDS.length, 5);
  });

  it('drops every capability and goes read-only', () => {
    assert.match(joined, /--cap-drop ALL/);
    assert.match(joined, /--read-only/);
    assert.match(joined, /no-new-privileges/);
    assert.match(joined, /--network agent-intern-shift/);
    assert.doesNotMatch(joined, /--privileged|--cap-add|--network host/);
  });
});
