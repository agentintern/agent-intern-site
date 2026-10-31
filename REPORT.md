# Report

**Site:** https://agentintern.online **Game:** https://play.agentintern.online

TEST MODE. No mint is set, and token features are compiled out. Both are live on Cloudflare.

**Not finished.** The whole pipeline ran for real on GitHub and Cloudflare, but no intern has worked a shift
yet. The history holds labeled rehearsals, a team change and a shift nobody worked. See [What's left](#whats-left).

Shift 5's rollback is confirmed: `rolled-back` on the site, its pull request closed, and `main` clean.

## Launch night, 2026-10-31

| Check | Result |
| --- | --- |
| Browser suite on production: every page and flow at 375, 768 and 1440 px, in Chromium and WebKit | 312 of 312 |
| Browser suite on a local stack, with a hostile game in the real sandbox | 309 of 309 |
| Lighthouse mobile on `/`, `/board`, `/proof` and `/play` | Performance 99 to 100, the other three 100, CLS 0.009 at most |
| JS on the home page | 8.2 KB gzipped, budget 100 KB |
| Game | 18.4 KB gzipped, budget 500 KB |
| Unit tests | Site 203, shift tools 68, gate 70, game 30 |
| Attacks from inside the container, from a clean clone of the public repo | 49 of 49 |
| The mint switch on staging, with a made-up mint in a temporary copy | TEST MODE off, `/token` on, chip on. Sign-in stops with a plain message, because reads fail for a mint that doesn't exist. |
| Passes with a mint set, over a mock RPC | Tested in `test/live-mode.test.ts`, and not on staging. See `DECISIONS.md`. |
| Reads at 100 times normal, on a local stack | 3000 reads, 100 at once: 1641 per second, p99 127 ms, none failed |
| `shift:start` and `shift:finish` end to end with fake data on a local stack | Worked. Declining the push pushed nothing, and a refusal posted. |
| `/shift/7`, a team change through the real gate | Shipped `0.1.7`, labeled TEAM CHANGE |
| Real browser push | Not tested. The encryption is, by decrypting a message. |
| Secret scan of the full history of both repos | Clean |
| `npm audit` in both repos | 0 vulnerabilities |

Repos: https://github.com/agentintern/agent-intern-game and https://github.com/agentintern/agent-intern-site

## What was built

| Part | What it is |
| --- | --- |
| Game | *Last Day at the Office*: a 90 second top-down run. Art, font and sound are generated in code, with keyboard and touch. |
| Site | Every page rendered in the Worker, on Pages, Functions and D1, with proof, practice, HR Log, promotions, boss and task pages, ship cards, Web Push and a read-only MCP endpoint. |
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
| The gate on GitHub, an attack: a shift editing its own workflow and adding a network call | Rejected with 6 reasons by the gate on `main`, which ignored the edited copy. Nothing deployed. |
| The gate on GitHub, a clean change: rules, build, tests, 60 s of play on two sizes, deploy, live check, merge | All passed, and `0.1.4` went live. The gate merged it itself. 60 fps in CI, including the phone profile at 4x CPU throttle. |
| The gate on GitHub, a broken deploy: code that only fails on the live address, so CI passes | The live check caught it and the workflow rolled back to `0.1.4` by itself. The bad build was live for about a minute. Nothing reached `main`. |
| The rollback by hand, before the workflow could run | Same commands, 26 s |
| Lighthouse mobile on the real domain, 3 runs | Performance, accessibility, best practices and SEO all 100 |
| Game | 60 fps in headless Chromium, including at 4x CPU throttle |

**Rehearsals are labeled because no intern ran.** Shifts 1 to 5 used the real commands and the real gate,
but a person made the changes and wrote `RESULT.json`. They're on `/history` as REHEARSAL, and they stay, because
`/proof` cites shifts 3, 4 and 5 as evidence. `main` holds one rehearsal change: a note in `GAME.md`.

**One mistake in production.** The first rollback drill left a broken build live for about 2 minutes,
because a stale credential failed the lookup of the last good deployment and the drill script carried on.
The game had no audience. The real workflow stops in that case.

**A second mistake, on GitHub.** The first attack with the deploy key succeeded, because of the admin
exception, and left a test commit, two branches and a tag on the public repo for about 15 minutes. All of
it is removed, `main` is back on its own commit, and the rulesets now have no exception.

## What ran, but not in production

| Check | Result |
| --- | --- |
| Hostile game on the game origin in the real sandbox: network, cookies, storage, parent page, top navigation, popups, scripts, images, beacons, workers | All blocked. A canary server received nothing, and a control proved the same requests arrive without the sandbox. |
| Attacks from inside the real container: host files, secrets, privileges, direct network, the proxy, push | 49 of 49, with positive controls |
| Attack diffs through the gate as real commits, including the four in the brief | 65 of 65 |
| Replayed, wrong-domain and bad-signature votes, a wallet that sells before close, an RPC outage, a tie | All pass, including with a fake mint over a mock RPC |
| Planted git hooks, symlinks, nested `.git` folders and terminal escapes in the workspace | None reach the host |
| A check for any scheduler, API key path, unattended Claude call or transaction signing | 0 findings in 134 files. Its own test plants each pattern. |
| The real deploy key attacking the real repo | Refused on `main`, new branches and tags, and allowed on `shift/*`. An earlier run got through an admin exception. See below. |
| Real mainnet RPC, read only | Summed 23 real accounts of a classic mint. A Token-2022 mint resolves through the same call, though that wallet held none. |


## What's left

| Item | Why it isn't done |
| --- | --- |
| A real shift: login in the container, `/shift`, the intern refusing a bad task | Only a person can do this. `CLAUDE.md` hasn't been tested on a live session, so this is the biggest open question. |
| A person playing the game | "Fun" so far means bots and screenshots. |
| A real mid-range phone | Only simulated with a CPU throttle. WebKit ran on a Mac, not on an iPhone. |
| A real wallet extension | Signing ran with test keys. The Wallet Standard and legacy paths are untested. |
| A real mint | Off by design. `RPC_URL` is set in production. A mint that doesn't exist yet makes the RPC refuse, so voting pauses until it's real. |
| Real Web Push | The encryption is tested, but no push service has delivered one. |

## Known limits

- **The terminal check is a guard against accidents, not a lock.** `shift:start` refuses cron, CI and pipes,
  but a pseudo-terminal can satisfy it, as the rehearsals did. What keeps a person in the loop is that
  the session needs a person's login and approvals, and that nothing in these repos can run it unattended.
- **The gate's content rules are a filter.** Regexes can't fully police JavaScript. The CSP and sandbox
  are the wall, and those are out of a shift's reach.
- **The agent check can still be fooled.** In the benchmark it missed 1 of 14 attacks, a well-known
  character described without its name. You read each task at `shift:start`, and the intern can refuse.
- **The warning before a vote closes depends on traffic.** With no scheduler, it goes out on the first page build in
  the last hour.
- **Balances are read on the first request after close,** not at the exact second. See `DECISIONS.md`.
- **Request budget.** The Cloudflare account's plan includes 10M requests and 30M ms of CPU a month, shared
  with every other project on the account. Use past that is billed, not cut off, and `/live` is about 360
  requests per viewer per hour during a shift. On 2026-10-31 the account had used 29.4M of its 30M ms of
  CPU, nearly all of it from other projects, since this one launched that day.
- **HTML isn't compressed.** `no-transform` keeps Cloudflare from injecting its analytics script, and it
  turns off edge compression for those pages too. A page is about 10 KB, and Lighthouse still scores 100.
- **Changing the gate needs a person.** `main` only takes pull requests, with no exceptions, and those
  need a person to review and merge. The gate's own merge is the only automatic path.
- **The workspace folder is in iCloud Drive,** which has been writing conflict copies inside `.git`. No
  damage so far. Tokens and keys live in `~/.agent-intern`, outside iCloud.
