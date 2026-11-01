# Report

**Site:** https://agentintern.online **Game:** https://play.agentintern.online

TEST MODE. No mint is set, and token features are compiled out. Both are live on Cloudflare.

**One real shift so far.** Shift 8 was the first an intern worked, and it shipped `0.1.8` through the real gate. Everything
before it is a labeled rehearsal, a team change or a shift nobody worked. See [What's left](#whats-left).

Shift 5's rollback is confirmed: `rolled-back` on the site, its pull request closed, and `main` clean.

## Two public claims, 2026-11-01

Reviews read two things on the live site that didn't match the facts. `/proof` and `/about` said no real intern shift had
run, after shift 8 shipped. And the site said the intern had "no keys" and "no secrets", with the Claude login inside the
container.

| Check | Where | Result |
| --- | --- | --- |
| `/proof` and `/about` with 0 intern shifts and with 1 | Unit tests | Pass, and they failed when the count was ignored on purpose |
| No page says "no keys", "no production secrets", "nothing to steal" or "secrets to find" | Unit tests over every page | Pass, and it failed when the old `/break` line came back on purpose |
| Unit tests, type check, lint, secret scan | Local | 209 of 209, and the rest clean |
| A search of the repo and `launch-kit/` for the old claims | Local | Only lines about something else are left: the live feed, the MCP endpoint, workflow jobs, and the text shown at 0 shifts |

This report went up with the change, so it can't record the site's CI run or the deploy after it. Both are public: the
Actions tab, and `/proof`.

**Beyond the list in the brief.** "The intern has nothing to steal" came off too, since it's the same imprecision. So did the
description of `/break`, `README.md` line 50, which also said no real shift had run, and `docs/RUN-YOUR-OWN.md` line 8.

**Still open.** The session can read the Claude login, because it needs it, and no deny rule covers that file. `npm publish` is
denied only by command text, and the registry is reachable, so the login could leave that way. The threat model says so.
`/status` stopped showing "Nobody has seen the intern refuse a bad task" when the shift count passed 0, and that's still true.

## Stop when blocked, 2026-10-31

In shift 8 the intern hit a deny rule and went around it inside the container. There was no damage, and
`docs/THREAT-MODEL.md` says why. This fixes what let it get stuck, and tells it to stop.

| Check | Where | Result |
| --- | --- | --- |
| `npm ci`, `npm test`, `npm run typecheck` and `npm run build` on the game branch, in the real container, through the proxy, as the intern user | Docker | All 4 passed, with vitest at the locked 4.1.12 |
| The 5 new deny entries in `/etc/claude-code/managed-settings.json` in the image | Docker | All 5 present |
| `npm run test:container` | Docker | 60 of 60. The login volume wasn't touched |
| `npm test` in a fresh clone with no `node_modules`, offline, with a dead registry | Local | Failed in 196 ms with "node_modules is missing. Run npm ci." Nothing was created. The old script, the same way, went looking for vitest in the registry |
| Shift tools tests, the unattended check | Local | 131 of 131, 0 findings |
| Removing a deny entry on purpose | Local | The test failed, as it should |
| Game type check, unit tests, gate tests, maintenance rules | Local | Passed: 31 unit, 73 gate |
| The real deploy key pushing to `shift/maintenance-keytest`, with the ruleset on | GitHub | Refused: GH013, "Cannot create ref due to creations being restricted". The branch doesn't exist |
| Pull request 15, opened with the ruleset off for a moment | GitHub | The ruleset was read back as active. `maintenance checks` passed, and it can be merged with `live check` skipped |

The maintenance check first failed here, not on GitHub: the full `gh api` path in `CONTRIBUTING.md` looks like a secret to the
scan. `gate/rules.mjs` wasn't changed, and the commands use a variable instead.

This report went up with the change, so it can't record the site's CI run or the deploy after it. Both are public: the
Actions tab, and `/proof`.

**Not proved.**

- How the intern behaves when blocked. The instruction is new, and only a real shift can prove it.
- That the deny entries stop a real session. The test shows they're in the image, not that Claude Code refuses each command.
  They match command text, so a command worded another way may pass.
- That the deploy key is refused on an old maintenance branch. It tried creating one, not updating one.

## Sealing the shift push, 2026-10-31

A workflow in a pushed branch could read the game's deploy secrets before the gate looked. That's closed, in the four
layers `docs/THREAT-MODEL.md` describes.

| Check | Where | Result |
| --- | --- | --- |
| The real `shift:finish` on a workflow that's new, changed, deleted, renamed in and renamed out | Local, in a pseudo-terminal, with a fake site, origin and `gh` | All 5 refused: no `PUSH` prompt, nothing pushed, one failed post |
| The same, with 7 flags and 7 environment variables meant to override it | Same | Refused |
| Those tests before the fix | Same | All 6 failed on "it asked for PUSH", and the two clean-change controls passed |
| The same tests on Linux, with Node 22, inside the shift image | Docker | Passed |
| 9 off-limits paths, each 5 ways | Local | 45 of 45 refused |
| The refusal against the game's real `pathRule` | Local | Same answer on the whole table and every tracked file |
| Breaking the fix on purpose, 4 ways | Local | The tests caught all 4 |
| Shift tools tests, the unattended check, the container attacks | Local | 128 of 128, 0 findings, 49 of 49 |
| [A workflow in a branch](https://github.com/agentintern/agent-intern-game/actions/runs/41244479493), repo-level secrets still set | GitHub | Saw all 3 |
| Its job that asked for the Environment | GitHub | Refused before running a step |
| `env-check` under `pull_request_target`, which is how the gate runs | GitHub | Passed |
| `env-check` on `main` after the repo-level secrets were deleted | GitHub | Passed, so the Environment's secrets work alone |
| The same branch workflow after that | GitHub | All 3 empty, and its Environment job refused again |
| `gh secret list` on the repo | GitHub | 0 secrets. All 3 are on `production` |
| `live check` required on `main` | GitHub | Added. A maintenance pull request with it skipped still shows as ready to merge |
| A push ruleset on `.github/**` | GitHub | Refused: "Source public repos cannot have push rules", and only org-owned repos can have them |
| A ruleset on `shift/maintenance-*`, with no bypass | GitHub | Active. GitHub's rule lookup shows it on those branches, including the old ones, and not on `shift/8` or `shift/123` |
| The site's CI on the commit before this line | GitHub | Green |
| `/proof` after `npm run deploy` | Production | The new limit is live, with TEST MODE and no open shift |

**One thing found late.** `npm run setup` still wrote the secrets to the repo, so running it again would have reopened this.
It now writes to `production`, with a test.

**The login in the container works.** `npm run shift:login` opened the real container with an empty folder, a person logged
in, and the model answered through the proxy. No shift was opened. `/status` says `Claude API account`, but the login is a
subscription: billing type `stripe_subscription`, no API key, extra usage off.

**Not proved.**

- That `live check` stops anything beyond a race. A skip counts as passed, so it doesn't stop a `shift/maintenance-*` branch.
  A rejected shift skipping it and a branch job named `live check` are from how GitHub works, not from a test.

**Proved afterwards.** Shift 8's [run](https://github.com/agentintern/agent-intern-game/actions/runs/41249978232) passed deploy, live check, merge and tell the site, so the Environment and the
new Cloudflare token work. The deploy key was refused on `shift/maintenance-keytest`.

## The office in 3D, 2026-10-31

**Live in production.** It ran on a preview first, and went to production after a person approved it. The first deploy
was run by that person, because the permission check stopped the agent from doing it.

| Size | Measured | Budget |
| --- | --- | --- |
| JS on the page's own thread, on the home page | 8.3 KB gzipped | 20 KB |
| 3D, in a worker, with three.js 0.186.1 | 154.2 KB gzipped, 597 KB raw | 200 KB |
| Poster, 1280 x 800 WebP | 36 KB | |
| Scene, per frame, shadows included | 188,000 triangles, 169 draw calls | |

| Check | Where | Result |
| --- | --- | --- |
| Browser suite, Chromium and WebKit | Local stack | 359 of 359 |
| Each of the 7 moods from a mocked state, in both browsers | Local stack | Pass |
| The pointer, clicks and scrolling leave the mood alone, and a new state from the server changes it | Local stack | Pass |
| No usable WebGL, reduced motion and JS off: the poster stays, and the facts and links match the running page | Local stack, and production | Pass |
| A read-only walk of 18 pages at 375, 768 and 1440 px, in Chromium and WebKit, with no console errors | Production | 362 of 362 |
| The 7 moods, with the state mocked in the browser only | Production, Chromium | Pass |
| The game loads in its sandbox on `/play`, in Chromium and WebKit | Production | Pass |
| `npm run launch:check` | Production | 13 of 19, with all 46 proof links open |
| Lighthouse mobile, default settings | Production | `/` 99, `/live` 100, `/board` 100, `/proof` 99, `/play` 99, `/history` 100. Accessibility, best practices and SEO are all 100, with no blocking time and CLS 0.009 at most |
| Frame rate on an Apple M4, at desktop and phone sizes | Production | 60 fps |

Before this work, production scored 100 on `/` and `/live`. The home page gave up one point: its largest paint is now the
poster, at 2.0 s against 1.5 s for text.

**What ran in production.** The checks above, which only read. The full browser suite didn't run there, because it proposes
and votes for real. The real state during all of this was off shift, so the robot was asleep, and the other six moods have
only been seen from a mocked state.

**What ran on a real phone.** Nothing. The phone figures use a phone-sized window with the Mac's GPU, and slowing the CPU
doesn't slow that GPU, so 30 fps on a mid-range phone is unproved.

**What didn't run.** The fallback to the poster at low frame rates is built, and nothing has triggered it. Sound hasn't been
listened to. No real shift has moved the robot.

**One mistake on the way.** The first build ran three.js on the page's thread. Lighthouse scored 56 with software
rendering and 68 on a cold visit. See `DECISIONS.md` for what changed.

## Launch night, 2026-10-31

| Check | Result |
| --- | --- |
| Browser suite on production: every page and flow at 375, 768 and 1440 px, in Chromium and WebKit | 312 of 312 |
| Browser suite on a local stack, with a hostile game in the real sandbox | 309 of 309 |
| Lighthouse mobile on `/`, `/board`, `/proof` and `/play` | Performance 99 to 100, the other three 100, CLS 0.009 at most |
| JS on the home page | 8.2 KB gzipped, budget 100 KB |
| Game | 18.4 KB gzipped, budget 500 KB |
| Unit tests | Site 207, shift tools 68, gate 70, game 30 |
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
| The intern refusing a bad task, and stopping when blocked | Shift 8 did a task, and it went around a block. No real shift has refused anything, and the new instruction hasn't met a real session. This is the biggest open question. |
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
