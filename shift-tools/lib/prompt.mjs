import { createInterface } from 'node:readline/promises';

// Every command that moves a shift forward stops here. With no terminal attached there is no one
// to ask, so it refuses. That's what stops these commands running from a schedule or a script.
export function requirePerson(command) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI) {
    throw new Error(`${command} needs a person at a real terminal. It won't run from a script, a schedule or CI.`);
  }
}

// Ctrl-D or a closed terminal counts as no answer, and no answer never confirms anything.
export async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const closed = new Promise((done) => rl.once('close', () => done('')));
  const answer = await Promise.race([rl.question(question).catch(() => ''), closed]);
  rl.close();
  return answer.trim();
}

export async function confirmWord(word, question) {
  return (await ask(`${question}\nType ${word} to continue: `)) === word;
}
