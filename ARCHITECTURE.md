# Architecture

Three parts, kept apart so a bad task can't reach holders.

```
 holders                    a person, at a keyboard
    |                                |
    v                                v
+------------------+        +------------------+
|  Site (this repo)|<-------|   Shift tools    |  runs on one machine, holds the secrets
|  Pages, Worker,  | events |   watcher, push  |
|  D1, Workers AI  |        +--------+---------+
+--------+---------+                 | mounts one folder
         ^                           v
         | results          +------------------+
         |                  |    Container     |  no secrets, no push, deny-by-default
+--------+---------+        |    Claude Code   |  network through an allowlist proxy
| Gate (GitHub     |        +--------+---------+
| Actions, on main)|                 | files, copied as plain data
+--------+---------+                 v
         | deploys          +------------------+
         +----------------->|  Game            |  own address, sandbox, no network
                            +------------------+
```

## The site

`functions/[[path]].ts` hands every request to `src/worker/index.ts`. Pages are rendered in the Worker by
`src/worker/html`, with an `html` template that escapes by default. Reads are cached at the edge for 15 seconds.
The browser code in `src/client` adds wallets and refreshes parts of a page by asking the server for it again, so
only the server renders.

Rounds have no scheduler. The first request after close time closes the round.

## A shift

1. `shift:start` shows the task to a person and clones the game twice: one pristine copy that never gets mounted,
   and one for the container.
2. `shift:open` starts Claude Code in the container. The person logs in and approves what it asks.
3. `shift:finish` copies plain files out, shows the diff and pushes with a deploy key that can only reach `shift/*`.
4. The gate runs from `main`: diff rules and a secret scan, build, unit tests, 60 seconds of play on two sizes, a
   deploy, a check of the live game, then a merge or a rollback.

## The game

It lives in its own repo and deploys to its own address. It has `connect-src 'none'` and a sandbox. A finished run
leaves it as one `postMessage` to the page, which validates the numbers.

## Decisions

See [DECISIONS.md](DECISIONS.md).
