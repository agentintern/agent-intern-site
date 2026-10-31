// The second filter. The watcher redacts every event on the machine that sends it, and this
// repeats the check here, so a bug on one side can't put a secret on a public page.
const PATTERNS: RegExp[] = [
  /sk-ant-[a-z0-9_-]{8,}/i,
  /\bsk-[a-z0-9_-]{20,}/i,
  /\bgh[pousr]_[a-z0-9]{20,}/i,
  /github_pat_[a-z0-9_]{20,}/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[a-z0-9-]{10,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}/i,
  /\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/,
  /\b[a-f0-9]{40,}\b/i,
  /\b[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9])/,
];

export function looksSecret(text: string): boolean {
  return PATTERNS.some((pattern) => pattern.test(text));
}
