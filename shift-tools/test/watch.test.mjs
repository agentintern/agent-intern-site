import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { hasSecret, redact } from '../lib/redact.mjs';
import { isSafePath, safeText } from '../lib/safe.mjs';
import { fileEvent, readTestCounts, readTestState, StateMachine } from '../lib/watch-logic.mjs';

// Built at runtime, so no scanner ever mistakes this test file for a real leak.
const FAKE = {
  anthropic: ['sk', 'ant', 'api03', 'FAKEfakeFAKEfakeFAKEfake123456'].join('-'),
  github: `ghp_${'FAKEfakeFAKEfake1234'.repeat(2)}`,
  aws: `AKIA${'FAKEFAKEFAKEFAKE'}`,
  solana: 'Fake'.padEnd(88, 'K'),
  hex: 'deadbeef'.repeat(8),
};

describe('redaction', () => {
  for (const [name, secret] of Object.entries(FAKE)) {
    it(`catches a planted ${name} secret`, () => {
      assert.equal(hasSecret(secret), true);
      assert.equal(redact(`before ${secret} after`), 'before [redacted] after');
    });
  }

  it('leaves normal text alone', () => {
    for (const text of ['src/ui/hud.ts', 'Added a stapler pickup.', 'tests/sim.test.ts', 'a1b2c3d']) {
      assert.equal(hasSecret(text), false, text);
    }
  });
});

describe('file events', () => {
  it('reports a normal change', () => {
    assert.deepEqual(fileEvent('src/ui/hud.ts', 'changed'), { kind: 'file', path: 'src/ui/hud.ts', change: 'changed' });
  });

  it('turns a secret in a file name into a redaction notice', () => {
    const event = fileEvent(`src/${FAKE.anthropic}.ts`, 'added');
    assert.deepEqual(event, { kind: 'redacted' });
    assert.equal(JSON.stringify(event).includes('sk-ant'), false);
  });

  it('turns an odd file name into a redaction notice', () => {
    for (const name of ['src/\x1b[31m.ts', 'src/a b.ts', '../../etc/passwd', 'src/evil\n.ts']) {
      assert.deepEqual(fileEvent(name, 'changed'), { kind: 'redacted' }, name);
    }
  });

  it('never reports git internals, dependencies, or the task', () => {
    for (const path of ['.git/config', 'node_modules/a/b.js', 'dist/game.js', 'TASK.md', '.shift/x']) {
      assert.equal(fileEvent(path, 'changed'), null, path);
    }
  });
});

describe('reading the files written inside the container', () => {
  let dir;
  before(() => { dir = mkdtempSync(join(tmpdir(), 'intern-watch-')); });
  after(() => { rmSync(dir, { recursive: true, force: true }); });

  it('takes only the counts from test results', () => {
    const path = join(dir, 'results.json');
    writeFileSync(path, JSON.stringify({ numPassedTests: 16, numFailedTests: 1, testResults: [{ message: FAKE.github }] }));
    assert.deepEqual(readTestCounts(path), { passed: 16, failed: 1 });
  });

  it('refuses a symlink to a file on this machine', () => {
    const path = join(dir, 'link.json');
    symlinkSync('/etc/hosts', path);
    assert.equal(readTestCounts(path), null);
    assert.equal(readTestState(path), null);
  });

  it('refuses counts that are not plain numbers', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, JSON.stringify({ numPassedTests: FAKE.github, numFailedTests: 0 }));
    assert.equal(readTestCounts(path), null);
    writeFileSync(path, JSON.stringify({ numPassedTests: -1, numFailedTests: 0 }));
    assert.equal(readTestCounts(path), null);
  });

  it('only accepts known test states', () => {
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify({ state: 'testing' }));
    assert.equal(readTestState(path), 'testing');
    writeFileSync(path, JSON.stringify({ state: FAKE.github }));
    assert.equal(readTestState(path), null);
  });
});

describe('the state machine', () => {
  it('moves from reading to writing to testing', () => {
    const machine = new StateMachine(60_000);
    assert.deepEqual(machine.fileChanged(), { kind: 'state', state: 'writing' });
    assert.equal(machine.fileChanged(), null);
    assert.deepEqual(machine.testsStarted(), { kind: 'state', state: 'testing' });
    assert.equal(machine.fileChanged(), null);
    assert.deepEqual(machine.testsFinished({ passed: 5, failed: 0 }), { kind: 'state', state: 'writing' });
  });

  it('says stuck after a quiet spell', () => {
    const machine = new StateMachine(60_000);
    const start = machine.lastActivity;
    assert.equal(machine.tick(start + 59_000), null);
    assert.deepEqual(machine.tick(start + 61_000), { kind: 'state', state: 'stuck' });
  });

  it('says stuck after three failing test runs in a row', () => {
    const machine = new StateMachine(60_000);
    machine.testsStarted();
    machine.testsFinished({ passed: 1, failed: 1 });
    machine.testsStarted();
    machine.testsFinished({ passed: 1, failed: 1 });
    machine.testsStarted();
    assert.deepEqual(machine.testsFinished({ passed: 1, failed: 1 }), { kind: 'state', state: 'stuck' });
  });
});

describe('text shown in a terminal', () => {
  it('strips escapes, bells and bidi overrides', () => {
    assert.equal(safeText('a\x1b]0;evil\x07b‮c'), 'a ]0;evil b c');
  });

  it('accepts normal paths and refuses tricky ones', () => {
    assert.equal(isSafePath('src/ui/hud.ts'), true);
    assert.equal(isSafePath('.claude/commands/shift.md'), true);
    for (const path of ['../x', 'a/../b', '/etc/passwd', 'a b', 'a/.git/c', '.git', 'a\\b', 'café.ts']) {
      assert.equal(isSafePath(path), false, path);
    }
  });
});
