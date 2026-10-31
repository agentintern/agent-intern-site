// What a shift may change: the same answer as pathRule in the game's gate/rules.mjs. The gate only looks
// after the push, and a workflow in a pushed branch runs before that, so this refuses first.
//
// It lives in these tools and never comes from the game, because by the time it runs the sync has replaced the
// workspace's and the host repo's files with the intern's. test/workspace.test.mjs compares the two.
const ALLOWED_PATH = /^(src\/[A-Za-z0-9_./-]+\.ts|tests\/[A-Za-z0-9_./-]+\.ts|GAME\.md)$/;
const PROTECTED_FILES = new Set(['src/ui/bridge.ts', 'src/version.ts']);

// The one rule in the gate that can stop a path the allowlist would pass: src/.env.ts, src/id_rsa.ts.
const SECRET_FILE = /(^|\/)(\.env|\.npmrc|id_rsa|id_ed25519)/;

const isRefused = (path) =>
  path.split('/').includes('..') || SECRET_FILE.test(path) || PROTECTED_FILES.has(path) || !ALLOWED_PATH.test(path);

export function refusedPaths(paths) {
  return paths.filter(isRefused);
}
