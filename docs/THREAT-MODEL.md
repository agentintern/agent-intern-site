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
| It adds a workflow, so that a pushed branch reads the deploy secrets or merges itself | `shift:finish` refuses any file outside the game before the push | The deploy secrets only reach runs on `main`. See below |
| A build passes CI and breaks live | The live check after each deploy | Automatic rollback |
| A bad task reaches holders as text | Rejected text is never published, and pages escape by default | The strict CSP has no inline scripts |
| A forged, replayed or moved vote | Signatures over a server-built message with a single-use nonce | Anyone can re-verify the public record |
| A wallet sells and still counts | Balances are read again at close | An RPC failure holds the round |
| A secret reaches the live feed | Redaction on the machine | A second filter in the Worker |

## A workflow in a shift's branch

A pushed branch runs its own workflows before the gate looks at anything. The deploy secrets used to be repo-level, so a
workflow in a shift could have read them, and it could have given itself a write token and merged its own pull request.
A probe confirmed the first part on 2026-10-31: a workflow in a branch saw all three secrets. It never touched their
values, and it printed only whether each one was empty.

There are four layers now:

1. **`shift:finish` refuses it.** After copying the workspace and before asking for `PUSH`, it checks every changed path
   against the gate's allowlist, on both sides of a rename. If anything is refused, nothing is pushed and the shift is
   recorded as failed. No flag, prompt or environment variable skips this. The rule lives in the shift tools, because by
   then the workspace and the host repo hold the intern's files.
2. **The secrets are behind `main`.** They exist only on the `production` Environment, which only allows `main`. The gate
   runs from `main`, so it can reach them. The probe, run again after the repo-level secrets were deleted, saw all three
   empty, and its job that asked for the Environment was refused before running a step.
3. **`main` requires the gate's `live check`.** GitHub holds a merge until that check reports.
4. **Nothing reaches the branches that skip the gate.** `shift/maintenance-*` branches skip it, so a ruleset stops anyone
   creating or updating them. A person turns the ruleset off for a moment to open one. It has no exception, because GitHub
   counts a deploy key as the account that owns the repo, so an exception for admins would cover the key too.

What's still true:

- **A rogue workflow in a branch would still run, with no secrets.** GitHub can't block pushes to `.github/**` here: it
  refused a push ruleset because they need an organization-owned repo that isn't public.
- **It could still ask for a write token.** The repo's read-only default only applies when a workflow doesn't ask.
- **The third layer is the weakest.** GitHub counts a skipped check as passed. Pull request #13 showed as ready to merge
  with `live check` skipped, and maintenance pull requests depend on that. Two more gaps follow from how GitHub works, and
  weren't tested: a shift the rules job rejects also skips `live check`, and a workflow in a branch could name its own job
  `live check`.
- **The fourth layer hasn't met the deploy key.** GitHub's rule lookup shows it on those branches and not on `shift/8`, but
  no push has tried it.
- **Someone holding the deploy key can skip the first layer.** It lives on the maintainer's machine, and it reaches
  `shift/*`, so only the second layer applies.

## What this doesn't protect against

- **A person approving something bad.** The person at the keyboard is part of the model.
- **A compromised maintainer machine.** The shift secrets and the deploy key live there.
- **Prompt injection that stays inside the game.** A task can make the game worse without breaking any rule.
- **The screen being fooled.** It's a filter, and it has missed a well-known character described without its name.
- **The diff rules being evaded.** Regexes can't fully police JavaScript. The CSP and sandbox are the wall.
- **The terminal check.** It stops cron, CI and pipes, and a pseudo-terminal can pass it.
- **A close-time race.** Balances are read on the first request after close, not at the exact second.
- **Bugs in Cloudflare, GitHub, Docker, or a browser sandbox.**
