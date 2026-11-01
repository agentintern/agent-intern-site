# Changelog

The game's versions are at https://agentintern.online/changelog. This file covers the site.

## Two public claims, 2026-11-01

- /proof and /about now take what's still open from the real shift count. They said no real shift had run after shift 8.
- Said plainly what the intern holds: no wallet, no deploy keys, and no site or gate secrets. The only credential inside the
  container is the Claude login, and the gate's deploy secrets live on GitHub, behind main.
- Added to the threat model what the Claude login reaches, and that the proxy allows Anthropic and the npm registry.

## Stop when blocked, 2026-10-31

- Added to /proof's container claim: in shift 8 the intern went around a deny rule on npm install, and deny rules only slow
  it down.
- Added shift 8 to the threat model.
- Said in the first shift guide what to reject, and that the intern starts with `npm ci`.

## Sealing the shift push, 2026-10-31

- Added to /proof's gate limits: deploy secrets only reach runs on main, shift:finish refuses files outside the game,
  and a skipped check counts as passed.
- Added the attack and its four layers to the threat model.
- Added `npm run shift:login` to the shift tools, so the first login doesn't need an open shift.

## The office in 3D, 2026-10-31

- Rebuilt the home page as four chapters over native scrolling, with a 3D robot made in code.
- The robot's mood comes from the real state: asleep, typing, stuck, shipped or refusing.
- Added the 3D robot to /live, a still of it to the 404, and a render of it to the default share card.
- Added guide lines, corner brackets, reveals and numbers that count up.

## After launch night, 2026-10-31

- Removed the TEST MODE ribbon from every page. Balances are still fake, and /board says so.
- Added the project's X account to the footer.
- Added the limit of the gate claim to /proof: team maintenance goes through pull requests a person merges.
- Made LICENSE the plain MIT text, and moved the font note to the README.

## Launch night, 2026-10-31

- Rebuilt the site as the office at night, with the robot intern and server-rendered pages.
- Added /proof, /practice, /hr, /break, /promotions, /security, /brand, /api, task and boss pages, and daily boards.
- Added /api/health, a manifest, llms.txt, a sitemap, RSS, a read-only MCP endpoint, Web Push and ratings.
- Added labels for who did the work: INTERN, REHEARSAL, TEAM CHANGE and NOT WORKED.
- Added HSTS, rate limits on every write and an edge cache for reads.
- Added `npm run launch:check`, a staging deploy of the mint switch, and a local read test.
- Added lights that come on when a shift starts, a Day 1 state, Founding Bosses, and a warning before a vote closes.
- Added "your task shipped" notifications for people who turned them on while signed in.
- Fixed a proof command that crashed in a clean clone, and old CSS staying live for hours after a deploy.

## First build, 2026-10-30

- Voting rounds, the holder pass, screening, the live feed, shift history and ship cards.
