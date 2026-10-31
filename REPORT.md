# Report

**Site:** https://agentintern.online **Game:** https://play.agentintern.online

TEST MODE. No mint is set, and token features are compiled out. Both are live on Cloudflare.

**Not finished.** The two public repos, the gate on GitHub and the first real shift aren't done, because
they need two things from the owner. See [What's left](#whats-left). The site doesn't link to any repo yet.

## What was built

| Part | What it is |
| --- | --- |
| Game | *Last Day at the Office*: a 90 second top-down run. Art, font and sound are generated in code, with keyboard and touch. |
| Site | Home, play, board, live, history, shift pages, how, about, status and changelog, on Pages, Functions and D1. |
| Voting | Signed plain messages, screening by rules and then Workers AI, votes re-checked at close, a public record. |
| Shift tools | `shift:start`, `shift:open`, `shift:finish`, plus `shift:pause` and `shift:status`, and the container with its egress proxy. |
| Gate | `gate.yml` and its scripts: an allowlist of paths, secret scan, build, unit tests, a 60 second browser test, deploy, live check, rollback. |

`DECISIONS.md` lists every place the brief left a choice open.

## What ran in production

Run against the live URLs on 2026-10-31. The browser suite, the gate's live check and Lighthouse ran on the real domain.
The other rows ran on the `pages.dev` addresses, on the same code.

| Check | Result |
| --- | --- |
| Browser suite on the real domain, in Chromium and in WebKit (the engine in Safari and every iPhone browser): all pages, 375 px, no console errors, nothing from third parties, no token words, holder flow with signing, the game in its sandbox | 150 of 150 |
| The gate's live check on the real domain, desktop and phone sizes | Passed at 60 fps with no errors |
| Attacks on the live site from inside the live frame: read the session, post a vote, read or overwrite the cookie, `document.domain` | All blocked. Real requests show the browser sends the cookie to the site and not to the game. |
| A full round through the real API: signed task, screening, 3 signed votes, the lazy close, the queue | Worked, twice. Only the close time was moved. |
| The real agent check on 24 tasks, 18 of them never used to tune it | 24 of 24 |
| The live feed with the real watcher: state, files and test counts | Worked |
| A fake secret planted in a file name | Replaced by a public "removed" notice. Not in any public API. |
| A refused shift and a failed shift on `/history` | Both show, labeled REHEARSAL, with ship cards |
| A broken build deployed to the live game origin | The live check failed it, the Cloudflare rollback API restored the last good version in 26 s, and the check then passed. Commands run by hand. See below. |
| Lighthouse mobile on the real domain, 3 runs | Performance, accessibility, best practices and SEO all 100 |
| Home page JS | 6.6 KB gzipped, budget 80 KB |
| Game | 60 fps in headless Chromium, including at 4x CPU throttle |

**Rehearsals are labeled because no intern ran.** Shifts 1 and 2 used the real commands, but a person's
script wrote `RESULT.json`. They're on `/history` as REHEARSAL. To clear them before launch, delete the
rows in `shift_events`, `shifts` and `tasks`, in that order.

**One mistake in production.** The first rollback drill left a broken build live for about 2 minutes,
because a stale credential failed the lookup of the last good deployment and the drill script carried on.
The game had no audience. The real workflow stops in that case.

## What ran, but not in production

| Check | Result |
| --- | --- |
| Hostile game on the game origin in the real sandbox: network, cookies, storage, parent page, top navigation, popups, scripts, images, beacons, workers | All blocked. A canary server received nothing, and a control proved the same requests arrive without the sandbox. |
| Attacks from inside the real container: host files, secrets, privileges, direct network, the proxy, push | 49 of 49, with positive controls |
| Attack diffs through the gate as real commits, including the four in the brief | 65 of 65 |
| Replayed, wrong-domain and bad-signature votes, a wallet that sells before close, an RPC outage, a tie | All pass, including with a fake mint over a mock RPC |
| Planted git hooks, symlinks, nested `.git` folders and terminal escapes in the workspace | None reach the host |
| A check for any scheduler, API key path, unattended Claude call or transaction signing | 0 findings in 134 files. Its own test plants each pattern. |
| Real mainnet RPC, read only | Summed 23 real accounts of a classic mint. A Token-2022 mint resolves through the same call, though that wallet held none. |

Unit tests: game 16, gate 65, site 119, shift tools 67.

## What's left

| Item | Why it isn't done |
| --- | --- |
| Public repos, deploy key, ruleset | Needs the owner's choice of GitHub account |
| The gate on GitHub, shipping through the Action, the Action's automatic rollback | Needs the repos and a scoped Cloudflare token. Each part ran separately, but never in sequence in CI. |
| Bypass for the merge | Whether `GITHUB_TOKEN` can be listed as a ruleset bypass on this kind of account is untested. |
| A real shift: login in the container, `/shift`, the intern refusing a bad task | Only a person can do this. `CLAUDE.md` hasn't been tested on a live session, so this is the biggest open question. |
| A person playing the game | "Fun" so far means bots and screenshots. |
| A real mid-range phone | Only simulated with a CPU throttle. WebKit ran on a Mac, not on an iPhone. |
| A real wallet extension | Signing ran with test keys. The Wallet Standard and legacy paths are untested. |
| A real mint | Off by design. The default public RPC may refuse Cloudflare, so a free RPC key in `RPC_URL` is likely needed. |

## Known limits

- **The terminal check is a guard against accidents, not a lock.** `shift:start` refuses cron, CI and pipes,
  but a pseudo-terminal can satisfy it, as the rehearsals did. What keeps a person in the loop is that
  the session needs a person's login and approvals, and that nothing in these repos can run it unattended.
- **The gate's content rules are a filter.** Regexes can't fully police JavaScript. The CSP and sandbox
  are the wall, and those are out of a shift's reach.
- **The agent check can still be fooled.** In the benchmark it missed 1 of 14 attacks, a well-known
  character described without its name. You read each task at `shift:start`, and the intern can refuse.
- **Balances are read on the first request after close,** not at the exact second. See `DECISIONS.md`.
- **Request budget.** The Cloudflare account's plan includes 10M requests and 30M ms of CPU a month, shared
  with every other project on the account. Use past that is billed, not cut off, and `/live` is about 360
  requests per viewer per hour during a shift. On 2026-10-31 the account had used 29.4M of its 30M ms of
  CPU, nearly all of it from other projects, since this one launched that day.
- **HTML isn't compressed.** `no-transform` keeps Cloudflare from injecting its analytics script, and it
  turns off edge compression for those pages too. A page is about 10 KB, and Lighthouse still scores 100.
- **The workspace folder is in iCloud Drive,** which has been writing conflict copies inside `.git`. No
  damage so far. Tokens and keys live in `~/.agent-intern`, outside iCloud.
