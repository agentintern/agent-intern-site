import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Proves the repos hold no way to run Claude without a person, and nothing that can sign a
// transaction. Run it over all three repos: node scripts/check-no-unattended.mjs [folder...]
const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, '../..');
const SELF = fileURLToPath(import.meta.url);
const OWN_TEST = resolve(here, '../test/unattended.test.mjs');

const FORBIDDEN = [
  ['print mode', /\bclaude\b[^\n]{0,40}[\s"'`[,(](-p|--print)\b/],
  ['setup token', /setup-token/],
  ['an API key path', /ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_OAUTH_REFRESH_TOKEN|apiKeyHelper/],
  ['skipping permissions', /--dangerously-skip-permissions|\bbypassPermissions\b|--permission-mode/],
  ['the agent SDK', /@anthropic-ai\/(sdk|claude-agent-sdk|claude-code-sdk)|claude_agent_sdk|query\(\{\s*prompt/],
  ['a system scheduler', /\bcrontab\b|\blaunchctl\b|\.plist\b|systemd|\btaskschd\b/],
  ['a Worker cron', /"crons"\s*:|\[triggers\]|scheduled\s*\(/],
  ['transaction signing', /signTransaction|signAllTransactions|signAndSendTransaction|sendTransaction|sendRawTransaction/],
];

const WORKFLOW_FORBIDDEN = [
  ['a workflow schedule', /^\s*schedule\s*:/m],
  ['a run on pull_request (it would use the branch copy of the workflow)', /^\s*pull_request\s*:/m],
];

// Only the proxy's allowlist may name Claude's API host. If the site ever did, it would be
// sending visitors' requests to Claude.
const API_HOST = /api\.anthropic\.com/;
const API_HOST_ALLOWED = new Set(['docker/proxy.mjs', 'test/container.mjs', 'shift-tools/docker/proxy.mjs', 'shift-tools/test/container.mjs']);

// Files that have to name a pattern in order to forbid it. Exempt from that one rule only.
const DETECTORS = {
  'gate/rules.mjs': new Set(['transaction signing']),
  'scripts/lint.mjs': new Set(['transaction signing']),
};

const SCANNED = new Set(['.ts', '.mjs', '.js', '.cjs', '.json', '.jsonc', '.toml', '.yml', '.yaml', '.sh', '.html', '.sql']);
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.wrangler', 'fixtures', 'screens', 'launch-kit', 'shift-tools']);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (SCANNED.has(extname(name)) || /Dockerfile$/.test(name)) yield path;
  }
}

export function scan(root) {
  const findings = [];
  let count = 0;
  for (const path of files(root)) {
    if (path === SELF || path === OWN_TEST) continue;
    count++;
    const relativePath = relative(root, path);
    const text = readFileSync(path, 'utf8');
    for (const [label, pattern] of FORBIDDEN) {
      if (pattern.test(text) && !DETECTORS[relativePath]?.has(label)) findings.push(`${relativePath}: ${label}`);
    }
    if (/\.github\/workflows\//.test(path)) {
      for (const [label, pattern] of WORKFLOW_FORBIDDEN) {
        if (pattern.test(text)) findings.push(`${relativePath}: ${label}`);
      }
    }
    if (API_HOST.test(text) && !API_HOST_ALLOWED.has(relativePath) && !basename(path).endsWith('.test.mjs')) {
      findings.push(`${relativePath}: names the Claude API host`);
    }
  }
  return { findings, count };
}

if (process.argv[1] === SELF) {
  const roots = process.argv.length > 2
    ? process.argv.slice(2)
    : ['agent-intern-game', 'agent-intern-site', 'agent-intern-shift'].map((name) => join(workspaceRoot, name));
  let failed = false;
  for (const root of roots) {
    const { findings, count } = scan(root);
    console.log(`${basename(root)}: ${count} files scanned, ${findings.length} findings`);
    for (const finding of findings) console.log(`  FAIL ${finding}`);
    failed ||= findings.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
