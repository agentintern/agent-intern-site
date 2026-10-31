# Changelog

The game's versions are at https://agentintern.online/changelog. This file covers the site.

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
