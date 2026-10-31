import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { postJson, readSecrets } from '../lib/api.mjs';
import { requireCurrent } from '../lib/current.mjs';
import { git } from '../lib/git.mjs';
import { CONFIG, CURRENT_FILE, hostRepoDir, PUSH_KEY, shiftDir, workspaceDir } from '../lib/paths.mjs';
import { ask, confirmWord, requirePerson } from '../lib/prompt.mjs';
import { redact } from '../lib/redact.mjs';
import { safeText } from '../lib/safe.mjs';
import { commitShift, diffSummary, readResult, syncWorkspaceToRepo } from '../lib/workspace.mjs';

requirePerson('shift:finish');

const current = requireCurrent();
const secrets = readSecrets();
const workspace = workspaceDir(current.id);
const host = hostRepoDir(current.id);

writeFileSync(join(shiftDir(current.id), 'stop'), '');

const result = readResult(workspace);
const summary = redact(result.summary);
const note = redact(result.note);

console.log(`\nShift ${current.id} result: ${result.status.toUpperCase()}`);
console.log(`  ${summary}`);
if (note) console.log(`  Note: ${note}`);

function closeLocal() {
  rmSync(CURRENT_FILE, { force: true });
}

if (result.status !== 'done') {
  if (!(await confirmWord('POST', 'This goes on the public history as it is.'))) process.exit(0);
  await postJson('/api/shift/finish', secrets.shiftToken, { shiftId: current.id, status: result.status, summary, note });
  closeLocal();
  console.log('Posted. The task will not run again.');
  process.exit(0);
}

if (!syncWorkspaceToRepo(workspace, host)) {
  console.log('The intern said done, but nothing changed. Recording it as failed.');
  await postJson('/api/shift/finish', secrets.shiftToken, {
    shiftId: current.id, status: 'failed', summary: 'The shift ended with no change to the game.', note,
  });
  closeLocal();
  process.exit(0);
}

const diff = diffSummary(host);
console.log(`\nDiff: ${diff.files.length} files, +${diff.added} -${diff.removed}\n`);
for (const file of diff.files) console.log(`  +${file.added} -${file.removed}  ${file.path}`);

const handEdited = (await ask('\nDid a person edit any of this by hand? It will be labeled in public. [y/N] ')).toLowerCase() === 'y';
if (!(await confirmWord('PUSH', '\nThis pushes the branch and starts the gate.'))) {
  console.log('Stopped. Nothing was pushed. Run shift:finish again when you are ready.');
  process.exit(0);
}

const commit = commitShift(host, current.id, summary);
const branch = `shift/${current.id}`;
git(host, ['push', 'origin', `${branch}:${branch}`], {
  env: { GIT_SSH_COMMAND: `ssh -i ${PUSH_KEY} -o IdentitiesOnly=yes -o IdentityAgent=none -o StrictHostKeyChecking=accept-new` },
});

const repo = `https://github.com/${CONFIG.gameRepo}`;
const base = git(host, ['rev-parse', 'origin/main']);
const diffUrl = `${repo}/compare/${base}...${commit}`;

// The pull request is what wakes the gate, which runs from main and never from this branch.
const open = execFileSync('gh', ['pr', 'list', '--repo', CONFIG.gameRepo, '--head', branch, '--json', 'url', '--jq', '.[0].url'], { encoding: 'utf8' }).trim();
const prUrl = open || execFileSync(
  'gh',
  ['pr', 'create', '--repo', CONFIG.gameRepo, '--base', 'main', '--head', branch, '--title', `Shift ${current.id}`, '--body', `Shift ${current.id}. The gate decides.`],
  { encoding: 'utf8' },
).trim();

await postJson('/api/shift/finish', secrets.shiftToken, {
  shiftId: current.id,
  status: 'done',
  summary,
  note,
  handEdited,
  filesChanged: diff.files.length,
  linesAdded: diff.added,
  linesRemoved: diff.removed,
  prUrl,
  diffUrl,
});

console.log(`\nPushed. The gate is running: ${safeText(prUrl, 200)}`);
console.log('If it fails, reopen with npm run shift:open (up to 2 more tries).');
