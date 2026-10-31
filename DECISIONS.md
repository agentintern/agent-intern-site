# Decisions

Short log of choices that fill gaps in the brief, or read it in a particular way.

## Isolation

**The leaderboard and "the game can't reach site APIs" looked like a conflict.** The brief wants
scores to reach the site and also wants the game unable to reach site APIs. Both hold: the game has
`connect-src 'none'` and no network at all. When a run ends it sends one `postMessage` to the page
that embeds it. That page checks the sender is exactly the sandboxed frame, copies out the numbers,
and calls the API itself. The game never talks to the API.

**The game's CSP includes `sandbox allow-scripts`.** The iframe attribute only protects embedded
visits. With the header too, someone who opens `agent-intern-play.pages.dev` directly still gets an
opaque origin with no cookies or storage.

**`Cross-Origin-Resource-Policy: cross-origin` on the game.** `same-origin` would block `game.js`
inside the sandbox, since an opaque origin isn't the same origin as anything.

## Screening

**The agent check uses Workers AI, not Claude.** The rules rule out sending visitors' text to Claude
or using an API key, so the check runs on a free Workers AI model (`llama-3.1-8b-instruct-fp8`) with
no tools. It fails closed: an error, a timeout or an unreadable answer leaves the task "in review",
and it's checked again on later requests. A round that closes first turns the task down.

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

## The shift

**A deploy key, not a personal token, for pushing.** A token on your account inherits your admin
rights, so "can only push `shift/*`" couldn't hold. A deploy key isn't an admin, so a ruleset binds it.

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

## Infrastructure

**Pages Functions are the Worker.** Same origin as the pages, so no CORS, and `SameSite=Strict` cookies
just work. The single API entry is `functions/api/[[path]].ts`.

**Before and after screenshots live in D1,** capped at 600 KB each. R2 needs a card on file, and this
avoids an external image host.

**Ship cards are PNGs built by hand in the Worker.** X doesn't show SVG, and this needs no WASM or service.
