import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { scan } from '../scripts/check-no-unattended.mjs';

// Each string is assembled here so that the real scan of this repo stays clean.
const piece = (...parts) => parts.join('');
const PLANTS = [
  ['print mode', 'run.sh', piece('claude', ' -p "do the task"')],
  ['print mode, long flag', 'run.mjs', piece('spawn("claude", ["--pr', 'int", task])')],
  ['setup token', 'a.sh', piece('claude setup', '-token')],
  ['an API key', 'a.mjs', piece('process.env.ANTHROPIC', '_API_KEY')],
  ['an OAuth token', 'a.mjs', piece('CLAUDE_CODE', '_OAUTH_TOKEN=x')],
  ['skipped permissions', 'a.sh', piece('claude --dangerously', '-skip-permissions')],
  ['bypass mode', 'settings.json', piece('{"defaultMode":"bypass', 'Permissions"}')],
  ['the agent SDK', 'package.json', piece('{"dependencies":{"@anthropic-ai/claude', '-agent-sdk":"1"}}')],
  ['a crontab', 'a.sh', piece('cron', 'tab -e')],
  ['launchd', 'a.sh', piece('launch', 'ctl load x')],
  ['a Worker cron', 'wrangler.jsonc', piece('{"cro', 'ns": ["0 18 * * *"]}')],
  ['a workflow schedule', '.github/workflows/a.yml', piece('on:\n  sche', 'dule:\n    - cron: "0 0 * * *"\n')],
  ['a branch-run gate', '.github/workflows/b.yml', piece('on:\n  pull', '_request:\n')],
  ['transaction signing', 'a.ts', piece('wallet.signTrans', 'action(tx)')],
  ['the Claude API from the site', 'worker.ts', piece('fetch("https://api.anth', 'ropic.com/v1/messages")')],
];

describe('the scan for unattended paths', () => {
  let root;
  before(() => { root = mkdtempSync(join(tmpdir(), 'intern-scan-')); });
  after(() => { rmSync(root, { recursive: true, force: true }); });

  for (const [label, file, content] of PLANTS) {
    it(`catches ${label}`, () => {
      const dir = mkdtempSync(join(root, 'case-'));
      const path = join(dir, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      assert.equal(scan(dir).findings.length > 0, true, `missed ${label}`);
    });
  }

  it('exempts a detector from its one rule and nothing else', () => {
    const dir = mkdtempSync(join(root, 'detector-'));
    mkdirSync(join(dir, 'gate'));
    writeFileSync(join(dir, 'gate/rules.mjs'), piece('const banned = /signTrans', 'action/;\n'));
    assert.deepEqual(scan(dir).findings, []);
    writeFileSync(join(dir, 'gate/rules.mjs'), piece('const banned = /signTrans', 'action/;\nclaude', ' -p "go"\n'));
    assert.equal(scan(dir).findings.length, 1);
  });

  it('passes clean code', () => {
    const dir = mkdtempSync(join(root, 'clean-'));
    writeFileSync(join(dir, 'ok.ts'), 'export const a = 1;\n');
    assert.deepEqual(scan(dir).findings, []);
  });
});
