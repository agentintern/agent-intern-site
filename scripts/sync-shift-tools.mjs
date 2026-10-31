import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

// The shift tools run on one person's machine. This copies them here so anyone can read the code that
// builds the container and run its tests. It's a copy: changes start in agent-intern-shift.
const from = '../agent-intern-shift';
if (!existsSync(from)) throw new Error('agent-intern-shift is not next to this repo');
rmSync('shift-tools', { recursive: true, force: true });
mkdirSync('shift-tools', { recursive: true });
for (const name of ['bin', 'lib', 'docker', 'scripts', 'test', 'config.json', 'package.json', '.gitignore']) {
  cpSync(`${from}/${name}`, `shift-tools/${name}`, { recursive: true });
}
writeFileSync('shift-tools/README.md', `# Shift tools (public copy)

Commands a person runs on their own machine to open a shift. Nothing here starts on its own.

This folder is a copy, so anyone can read the code that builds the container and run its tests.

\`\`\`
npm run shift:start          # shows the next task and asks you to confirm
npm run shift:open           # opens Claude Code in the container: /login, then /shift
npm run shift:finish         # shows the diff, pushes if you confirm
npm run shift:team -- text   # a change by the team, labeled TEAM CHANGE
npm run shift:pause -- why   # pauses voting and shifts
npm test                     # hostile workspace, redaction, watcher
npm run test:container       # real attacks from inside the real container
npm run check:no-unattended  # no scheduler, API key path or unattended Claude Code call
\`\`\`
`);
console.log('copied');
