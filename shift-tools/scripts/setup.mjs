import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT, PUSH_KEY, SECRETS_FILE } from '../lib/paths.mjs';

// One-time setup for GitHub. It runs under whichever account `gh` is logged in to.
// node scripts/setup.mjs --owner <github account>
// The Cloudflare token comes from the file ~/.agent-intern/cloudflare_token and is deleted after use.
const { values } = parseArgs({ options: { owner: { type: 'string' } } });
if (!values.owner) throw new Error('usage: npm run setup -- --owner <github account>');

const owner = values.owner;
const workspaceRoot = resolve(ROOT, '..');
const gameDir = join(workspaceRoot, 'agent-intern-game');
const siteDir = join(workspaceRoot, 'agent-intern-site');
const gameRepo = `${owner}/agent-intern-game`;
const siteRepo = `${owner}/agent-intern-site`;
const ACCOUNT_ID = '3c6da0286b93a75175cbc3f1f12c345a';
const tokenFile = join(resolve(SECRETS_FILE, '..'), 'cloudflare_token');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
// On the Environment, never the repo: a workflow in a pushed branch can read repo-level secrets.
const setSecret = (name, value) => run('gh', ['secret', 'set', name, '--env', 'production', '--repo', gameRepo], { input: value });

const login = run('gh', ['api', 'user', '--jq', '.login']);
if (login.toLowerCase() !== owner.toLowerCase()) {
  const orgs = run('gh', ['api', 'user/orgs', '--jq', '.[].login']).split('\n');
  if (!orgs.some((org) => org.toLowerCase() === owner.toLowerCase())) {
    throw new Error(`gh is logged in as ${login}, which can't publish to ${owner}. Run gh auth login first.`);
  }
}

function publish(repo, dir) {
  if (!has('gh', ['repo', 'view', repo])) {
    run('gh', ['repo', 'create', repo, '--public', '--disable-wiki']);
    console.log(`created ${repo}`);
  }
  if (!has('git', ['-C', dir, 'remote', 'get-url', 'origin'])) {
    run('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${repo}.git`]);
  }
  run('gh', ['auth', 'setup-git']);
  run('git', ['-C', dir, 'push', '-u', 'origin', 'main']);
  console.log(`pushed ${repo}`);
}

function writeRepoLinks() {
  const path = join(siteDir, 'config/site.json');
  const site = JSON.parse(readFileSync(path, 'utf8'));
  site.repos = { site: `https://github.com/${siteRepo}`, game: `https://github.com/${gameRepo}` };
  writeFileSync(path, `${JSON.stringify(site, null, 2)}\n`);
  const shift = join(ROOT, 'config.json');
  const config = JSON.parse(readFileSync(shift, 'utf8'));
  config.gameRepo = gameRepo;
  writeFileSync(shift, `${JSON.stringify(config, null, 2)}\n`);
}

function deployKey() {
  if (!existsSync(PUSH_KEY)) {
    run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'agent-intern-shift-push', '-f', PUSH_KEY]);
    chmodSync(PUSH_KEY, 0o600);
  }
  const keys = run('gh', ['repo', 'deploy-key', 'list', '--repo', gameRepo]);
  if (!keys.includes('shift push')) {
    run('gh', ['repo', 'deploy-key', 'add', `${PUSH_KEY}.pub`, '--repo', gameRepo, '--title', 'shift push', '--allow-write']);
  }
  console.log('deploy key is on the game repo');
}

// A deploy key isn't an admin, so these rules bind it to shift/ branches. GitHub won't let Actions
// bypass a ruleset on a personal account, so main takes pull requests instead: a deploy key can't open
// or merge one, and the gate's merge can. Nothing but a merged pull request ever reaches main.
function rulesets() {
  // No bypass for anyone. GitHub counts a deploy key as the account that owns the repo, so an
  // exception for admins would be an exception for the key. Maintenance means pausing a ruleset.
  const bypass = [];
  const wanted = [
    {
      name: 'main only through a pull request',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
          },
        },
        {
          type: 'required_status_checks',
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: [{ context: 'live check', integration_id: 15368 }],
          },
        },
      ],
      bypass_actors: bypass,
    },
    {
      name: 'only shift branches',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/heads/shift/**', '~DEFAULT_BRANCH'] } },
      rules: [{ type: 'creation' }, { type: 'update' }, { type: 'deletion' }],
      bypass_actors: bypass,
    },
    {
      // The gate skips these branches, so the deploy key must not be able to reach them. A person turns this off to open one.
      name: 'maintenance branches stay closed',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/shift/maintenance-*', 'refs/heads/shift/maintenance-*/**'], exclude: [] } },
      rules: [{ type: 'creation' }, { type: 'update' }],
      bypass_actors: bypass,
    },
    {
      name: 'no tags',
      target: 'tag',
      enforcement: 'active',
      conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
      rules: [{ type: 'creation' }, { type: 'update' }, { type: 'deletion' }],
      bypass_actors: bypass,
    },
  ];
  const existing = run('gh', ['api', `repos/${gameRepo}/rulesets`, '--jq', '.[].name']).split('\n');
  for (const ruleset of wanted) {
    if (existing.includes(ruleset.name)) continue;
    run('gh', ['api', '-X', 'POST', `repos/${gameRepo}/rulesets`, '--input', '-'], { input: JSON.stringify(ruleset) });
    console.log(`ruleset on: ${ruleset.name}`);
  }
}

function secrets() {
  const { gateToken } = JSON.parse(readFileSync(SECRETS_FILE, 'utf8'));
  setSecret('GATE_TOKEN', gateToken);
  setSecret('CLOUDFLARE_ACCOUNT_ID', ACCOUNT_ID);
  if (existsSync(tokenFile)) {
    const token = readFileSync(tokenFile, 'utf8').trim();
    // A clipboard mix-up saves the wrong text here, and a bad secret only shows up later as a failed deploy.
    if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) throw new Error(`${tokenFile} doesn't look like a Cloudflare token.`);
    setSecret('CLOUDFLARE_API_TOKEN', token);
    run('rm', ['-f', tokenFile]);
    console.log('secrets are set, and the token file is gone');
  } else {
    console.log(`no ${tokenFile} yet, so deploys will fail until it's added`);
  }
}

writeRepoLinks();
for (const dir of [gameDir, siteDir, ROOT]) {
  run('git', ['-C', dir, 'add', '-A']);
  if (!has('git', ['-C', dir, 'diff', '--cached', '--quiet'])) {
    run('git', ['-C', dir, 'commit', '-q', '-m', 'Point at the public repos']);
  }
}
publish(gameRepo, gameDir);
publish(siteRepo, siteDir);
deployKey();
rulesets();
secrets();
console.log('done. Redeploy the site so the repo links appear: cd ../agent-intern-site && npm run deploy');
