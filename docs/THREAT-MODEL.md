# Threat model

What could go wrong, and what stops it. No outside review has checked this.

## What we protect

Holders' wallets and sessions, the machine that runs shifts, the production secrets, and the honesty of the record.

## The attacker

Someone who can write tasks, and who assumes the model will do whatever a task says.

| Attack | What stops it | If that fails |
| --- | --- | --- |
| A task tells the intern to change its rules | `CLAUDE.md` says tasks are untrusted, and a person approves actions | The gate fails anything outside `src/`, `tests/` and `GAME.md` |
| The intern is tricked into stealing secrets | The container has none. Tested with `shift-tools/test/container.mjs` | The network is deny-by-default through an allowlist proxy |
| It writes code that calls out from the game | Diff rules | `connect-src 'none'` and the sandbox, which the shift can't touch |
| It edits the gate | The gate runs from `main` through `pull_request_target` | Diff rules fail the path |
| It plants a git hook to run on the host | `shift:finish` never runs git in that folder | Links, nested `.git` folders and odd names are refused |
| It pushes something itself | No remote, no credentials, no route | The deploy key can only reach `shift/*`, and a ruleset enforces it |
| A build passes CI and breaks live | The live check after each deploy | Automatic rollback |
| A bad task reaches holders as text | Rejected text is never published, and pages escape by default | The strict CSP has no inline scripts |
| A forged, replayed or moved vote | Signatures over a server-built message with a single-use nonce | Anyone can re-verify the public record |
| A wallet sells and still counts | Balances are read again at close | An RPC failure holds the round |
| A secret reaches the live feed | Redaction on the machine | A second filter in the Worker |

## What this doesn't protect against

- **A person approving something bad.** The person at the keyboard is part of the model.
- **A compromised maintainer machine.** The shift secrets and the deploy key live there.
- **Prompt injection that stays inside the game.** A task can make the game worse without breaking any rule.
- **The screen being fooled.** It's a filter, and it has missed a well-known character described without its name.
- **The diff rules being evaded.** Regexes can't fully police JavaScript. The CSP and sandbox are the wall.
- **The terminal check.** It stops cron, CI and pipes, and a pseudo-terminal can pass it.
- **A close-time race.** Balances are read on the first request after close, not at the exact second.
- **Bugs in Cloudflare, GitHub, Docker, or a browser sandbox.**
