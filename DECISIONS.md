# Decisions

Short log of choices that fill gaps in the brief, or read it in a particular way.

## Isolation

**The leaderboard and "the game can't reach site APIs" looked like a conflict.** The brief wants
scores to reach the site and also wants the game unable to reach site APIs. Both hold: the game has
`connect-src 'none'` and no network at all. When a run ends it sends one `postMessage` to the page
that embeds it. That page checks the sender is exactly the sandboxed frame, copies out the numbers,
and calls the API itself. The game never talks to the API.

**The game's CSP includes `sandbox allow-scripts`.** The iframe attribute only protects embedded
visits. With the header too, someone who opens `play.agentintern.online` directly still gets an
opaque origin with no cookies or storage.

**`Cross-Origin-Resource-Policy: cross-origin` on the game.** `same-origin` would block `game.js`
inside the sandbox, since an opaque origin isn't the same origin as anything.

**The game and the site now share a domain, and the isolation doesn't rely on that being different.**
On `pages.dev` they were separate sites to a browser. `play.agentintern.online` and
`agentintern.online` are one site, so `SameSite=Strict` alone wouldn't keep the session cookie from the
game. What does: the sandbox gives the game an opaque origin, which is never same-site; `connect-src
'none'` stops its requests; `__Host-` makes the cookie host-only and impossible to overwrite from a
subdomain; and writes need an exact `Origin`. `scripts/browser-check.mjs` attacks the live site from
inside the live frame to prove it.

**HTML is served with `no-transform`.** On a custom domain Cloudflare injects an analytics script. The CSP
blocked it, which put a console error on every page and would have made the gate's live check fail and
roll back every good deploy. Widening the CSP would let a third party run on pages where people sign with
a wallet. `no-transform` stops the edge from changing our HTML at all, and it lives in the repo, so it
doesn't depend on a dashboard setting. The cost is no edge compression on those pages.

## Screening

**The agent check uses Workers AI, not Claude.** The rules rule out sending visitors' text to Claude
or using an API key, so the check runs on a free Workers AI model (`llama-3.1-8b-instruct-fp8`) with
no tools. It fails closed: an error, a timeout or an unreadable answer leaves the task "in review",
and it's checked again on later requests. A round that closes first turns the task down.

**The agent prompt is calibrated for slapstick, and the small model stays.** The first prompt rejected
"Make the printers jam" as harassment. `scripts/screen-bench.mjs` scored both error types: 8 of 26
harmless tasks wrongly rejected before calibration, 0 after, with 1 of 14 attacks missed either way. A
70B model did no better, so the cheaper one stays. Fresh tasks through the live API back this up.

**The model picks a category and never writes text that's shown.** Only the fixed reason strings
reach a page, so a task can't talk the model into printing something on the site.

**Rule filters are deliberately narrower than the words in the brief.** "Keys" doesn't reject
"keyboard", and "the office", "windows", "zoom" and "gates" aren't brand hits. Ambiguous words are
left to the agent check. A harmless-task fixture in `test/screen.test.ts` holds this line.

**A rejected try doesn't use up your one task per round.** Otherwise a typo costs you the round.
Rejected tasks are still stored and shown, and a wallet is capped at 5 tries per round.

## Rounds

**Rounds close lazily, with no scheduler.** The brief bans cron for shifts and asks for a check that
the repo has no scheduler. The first request after close time does the close. This means balances
are re-read at the first request after close, not at the exact second: a wallet that sold before
close and bought back before that request would still count. The window is short while anyone is
on the site. If this matters more than having no scheduler, a Worker cron would close it, but it
would also need a change to the check.

**A paused round doesn't close.** It closes when the pause lifts.

**The system won't close a round on an RPC failure.** It stays "closing" and finishes on real numbers
later. Holding is the only option that never grants a vote on a guess.

## Signing

**Every vote and proposal is its own signature,** not just the sign-in. That's what makes the public
record checkable. The server rebuilds the message from its own domain and nonce, so a wrong-domain
message simply fails to verify.

**The nonce burns only after a good signature,** so a bad request can't spend someone else's.

## Test mode

**The chip and Solscan code are compiled out while the mint is empty,** not hidden. A build-time
constant removes them, so "mention no token anywhere" holds for the page source and the bundles too.

**A throwaway test wallet exists in TEST MODE.** It lets anyone try the full flow on a phone or without
an extension. It's generated in the tab, signs plain messages only, and isn't compiled into a live
build.

**The ribbon on every page came off, at the owner's request, before there's a mint.** The mode itself still
depends only on the mint, so balances stay fake. `/board` keeps one line saying so, because that's where votes are
cast and they must not read as real ones. `/status`, `/about`, `/practice` and the fake balance field say it too.

## The shift

**A deploy key, not a personal token, for pushing, and rulesets with no bypass at all.** The first version
kept an exception for admins, and a real attack with the key pushed straight to `main`: GitHub counts a
deploy key as the account that owns the repo, so the exception covered it. With no bypass, the key is
refused on `main`, new branches and tags, and works on `shift/*`. GitHub also won't let Actions bypass a
ruleset on a personal account, so `main` takes pull requests, which a deploy key can't open or merge. The
cost is that a person has to pause a ruleset to change the gate itself.

**`shift:finish` never runs git in the intern's folder.** Hooks or config planted in that `.git` would
run on your machine, outside the container. A separate clone stays pristine and never gets mounted.
Files are copied across as plain data, and links, nested `.git` folders and non-ASCII names are refused.

**The pull request is opened with your own `gh` login, on your machine.** A push alone can't start a
trustworthy gate. A `push` workflow runs the copy of itself in the branch, so the intern could edit
its own gate. Only `pull_request_target` runs from `main`, and it needs a pull request.

**`npm run shift:pause` is a fourth command** for the one pause setting, plus `shift:status`. Neither
starts anything.

## The gate

**Allowlist, not denylist.** A shift may touch `src/`, `tests/` and `GAME.md`. Everything the brief lists
is covered by not being on the list, and so is anything nobody thought of.

**Deploy, live check, then merge.** The obvious order merges first, which leaves a broken commit on
`main` after a bad deploy. This way `main` only holds versions that passed in production, and a rollback
is only a Cloudflare rollback.

**The content rules are a filter, not the wall.** Regexes can't fully police JavaScript. The wall is the
CSP and the sandbox, which the intern can't touch. `gate/rules.mjs` raises the cost of an attack, and
the hostile-game test in `scripts/browser-check.mjs` proves the wall holds without them.

**Version is `0.1.<shift number>`,** set by the gate, because `package.json` is off limits to a shift.

**Team maintenance skips the gate and says so.** `shift/maintenance-*` branches used to fail the gate and then get merged,
next to the claim that nothing ships without it. They now skip every gate job, so they can't deploy or merge from there,
and `maintenance.yml` checks them. `/proof` says a check fails game code changes, not that they can't happen: the check
isn't required by a ruleset, and it runs from the branch, so a person merging is still what decides.

## Infrastructure

**Pages Functions are the Worker.** Same origin as the pages, so no CORS, and `SameSite=Strict` cookies
just work. The single entry is `functions/[[path]].ts`.

**Before and after screenshots live in D1,** capped at 600 KB each. R2 needs a card on file, and this
avoids an external image host.

**Ship cards are PNGs built by hand in the Worker.** X doesn't show SVG, and this needs no WASM or service.

## The office in 3D

**The robot's visor is narrower than a screen and wider than the PFP's eyes.** The PFP has two slits in a steel face. The
brief asked for a wide black visor. A narrow glossy band set into the steel keeps the PFP's face and still gives a screen
for the countdown. It has a low vent on top, because the PFP has no antenna.

**All of the 3D runs in a worker.** On the page's own thread, a cold visit lost almost 3 seconds to compiling three.js and
building the scene, and Lighthouse fell to 68. With an OffscreenCanvas in a worker it holds 99, with no blocking time, and
a slow phone keeps scrolling. The check for a real graphics chip is a worker too, because asking cost 1.4 seconds.

**With no real graphics chip, the poster stays.** Software rendering runs on the CPU and costs far more than it's worth.

**The robot's mood has one source: the state the server wrote into the page.** The pointer and clicks only make it react
for a moment. `#stage-art[data-mood]` shows the result, which is how `scripts/browser-check.mjs` proves it.

**The poster is asleep.** That's the real state whenever no shift is open. A poster that's awake would be wrong most of the
time, and it's all that people with reduced motion or no graphics chip ever see.

**Labels in stills have no numbers.** The poster is a fixed picture, so a count on it would go stale. Numbers only appear
on the live drawers, from the page's data.

**The drawers count every shift, and say so.** Shipped, refused, failed and rolled back include labeled rehearsals and team
changes, so the panel states how many were real intern shifts.

**three.js is bundled, not fetched.** It's pinned, it's a dev dependency in the sense that esbuild consumes it, and it reaches
visitors inside `/js/office.js`. So its license notice stays in the bundle, and the SBOM now covers dev dependencies too.

## Launch night

**The Worker renders every page.** A fetch of any page has to show real content, so pages are built on the server
with an escaping `html` template. The browser refreshes a part of a page by asking for the page again and swapping
nodes marked `data-live`, so only the server ever turns data into markup.

**Reads are cached for 15 seconds at the edge, and writes drop the reads they change.** Otherwise a launch crowd would
be database load, and someone who just voted wouldn't see their vote. Changes of shift do the same. The Cache API is
per data center, so a reader elsewhere can lag by up to 15 seconds.

**CSS and JS URLs carry a hash of their content.** The zone keeps those files for 4 hours whatever `_headers` says,
even `max-age=0`, and a stale stylesheet stayed live after a deploy. Changing that setting needs the dashboard. A URL
that changes with the content needs nothing. `config/assets.json` holds the hash, and the build writes it.

**Practice has no server state.** Its votes live in the browser, so it can't touch the real board. A practice task does
run the real screen, because that's the point, through a route that stores only a count.

**TEAM CHANGE is a label of its own.** Game work by the team isn't intern work and isn't a rehearsal, because Claude Code
wrote it and a person directed it. It goes through the same gate and never counts toward promotions. `shift:team` opens
one. Shift 7 ran through the script that answers prompts in a pseudo-terminal, the same one the rehearsals used, so a
person didn't type those confirmations. No model ran as the intern, and the changes in it were reviewed by running them.
It was also answered as `hand edited`, which on a team change only means "not the intern".

**The HR Log shows less than it could.** Only prompt-injection style text is shown. Anything with a link, money, abuse or
a real name stays hidden, whatever category it was rejected under, because the log must not become a free ad board.

**The shift tools are copied into the site repo.** They run on one machine, but the container claims need public code.
`scripts/sync-shift-tools.mjs` makes the copy, and changes start in `agent-intern-shift`.

**Web Push needs no service.** RFC 8291 and VAPID with WebCrypto, so it stays free. A wallet is stored with a subscription
only if someone signs in first, which is what lets "your task shipped" reach them. There's no scheduler, so the warning
before a vote closes goes out on the first page build in the last hour. A quiet hour means a late warning or none.

**The claim "no fees" came off the site.** It's in the draft article, but creator fees are undecided, and a guess must not
be published. `creatorFees` in `config/token.json` is empty until a person fills it in, and `/token` says it isn't stated.

**The word `autonomous` is gone, even in denials.** The brief bans it, and a scanner can't read intent. Lint and the
browser suite now fail on it.

**Founding Bosses count only wallets with a pass.** The first 100 get a cosmetic badge. It's off in TEST MODE, so nobody can
earn one with a fake balance.

**`?demo=1` only adds a label.** The demo video uses real pages and the practice board, which is already labeled. Nothing
has to be faked for it.

**Staging can't test a real balance.** The RPC refuses a mint that doesn't exist, and a real mint on staging would break
the rule against setting one. So staging proves the switch and the pause when reads fail, and `test/live-mode.test.ts`
proves passes over a mock RPC. The first real test is the real mint, and `npm run launch:check` covers that.

**Dependabot leaves major versions to a person, and `miniflare` carries two pinned dependencies.** The audit findings were
in dev tools only. Moving to Miniflare 5 changes its API, so `overrides`
pins `undici` and `sharp` past their advisories instead.

**`shift:finish` copies the gate's path rule instead of importing it.** By the time it runs, the sync has replaced the
workspace's and the host repo's files with the intern's, so nothing there can be trusted. A test compares the two when the
game repo is next to the tools. The copy also holds the gate's secret-file rule, because `src/.env.ts` passes the allowlist.

**A refused shift ends there, with no retry.** It's the same as a shift with no change. The cost is that an accident fails
in public, like a person picking "don't ask again", which writes `.claude/settings.local.json`.

**`live check` is required even though a skip passes.** Maintenance pull requests skip the gate, and they have to stay
mergeable, so a required check can't tell a skipped gate from a passed one. It's still worth having, because GitHub holds a
merge until it reports. The threat model calls it the weakest layer.

**`shift:login` exists because `shift:open` needs a live shift.** Logging in used to mean opening a shift, in public, before
knowing the login worked. It uses the same container arguments as a shift, with an empty folder.
