import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

// A small lint with no dependency: the rules this project actually cares about.
const RULES = [
  ['innerHTML in the client', /\.innerHTML|outerHTML|insertAdjacentHTML|document\.write/, (p) => p.startsWith('src/client')],
  ['an inline style attribute', /\sstyle="/, (p) => p.startsWith('src/worker/html')],
  ['an inline script', /<script>(?!<)/, (p) => p.startsWith('src/worker/html')],
  ['a claim the project does not make', /\bautonomous\b|24\/7|runs by itself|\baudited\b|guaranteed|ai-powered security/i, (p) => p.startsWith('src/worker/html')],
  ['a transaction call', /signTransaction|signAllTransactions|signAndSendTransaction|sendTransaction/, (p) => p.startsWith('src/')],
  ['a console.log in the client', /console\.log/, (p) => p.startsWith('src/client')],
  ['a TODO left behind', /\b(TODO|FIXME|XXX)\b/, (p) => p.startsWith('src/') || p.startsWith('scripts/')],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (['.ts', '.mjs', '.js'].includes(extname(name))) yield path;
  }
}

const problems = [];
for (const path of [...walk('src'), ...walk('scripts'), ...walk('functions')]) {
  if (path === 'scripts/lint.mjs') continue;
  const text = readFileSync(path, 'utf8');
  for (const [label, pattern, applies] of RULES) {
    if (applies(path) && pattern.test(text)) problems.push(`${path}: ${label}`);
  }
}
for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(`${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
