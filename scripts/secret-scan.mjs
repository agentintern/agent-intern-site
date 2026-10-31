import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Runs before every commit, and by hand before a push: node scripts/secret-scan.mjs [--history]
const PATTERNS = [
  ['an Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['an API key', /\bsk-[A-Za-z0-9]{32,}/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/],
  ['a Cloudflare token', /\bcfut_[A-Za-z0-9_-]{30,}/],
  ['an AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['an RPC key in a URL', /[?&]api-key=[0-9a-f]{8}-[0-9a-f]{4}/i],
  ['a wallet secret key', /\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/],
];

// Values this machine holds are checked by exact match, wherever they came from.
function localSecrets() {
  const file = join(homedir(), '.agent-intern', 'secrets.json');
  if (!existsSync(file)) return [];
  return Object.values(JSON.parse(readFileSync(file, 'utf8'))).filter((v) => typeof v === 'string' && v.length > 16);
}

const history = process.argv.includes('--history');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 });
const text = history ? git('log', '-p', '--all', '--format=%H %an %ae %s %b') : git('diff', '--cached', '--unified=0');
const added = history ? text : text.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n');

const hits = new Set();
for (const [label, pattern] of PATTERNS) {
  if (pattern.test(added)) hits.add(label);
}
for (const value of localSecrets()) {
  if (added.includes(value) || added.includes(value.replace(/^.*api-key=/, ''))) hits.add('a secret from this machine');
}

for (const hit of hits) console.log(`SECRET: ${hit}`);
console.log(hits.size ? 'blocked' : `clean (${history ? 'full history' : 'staged changes'})`);
process.exit(hits.size ? 1 : 0);
