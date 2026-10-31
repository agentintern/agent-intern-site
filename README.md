# Agent Intern: the site

We hired an AI intern. Holders are its boss. Holders vote, the intern ships it, and a person starts
every shift.

This repo is the site: home, voting, the live feed, history and status, on Cloudflare Pages with
Functions and D1. The intern can never touch it. The game is a separate repo on its own origin.

```
npm ci
npm test                  # API and voting, against a real D1 engine
npm run test:browser      # the whole stack in real browsers, with a hostile game in the sandbox
npm run dev               # http://localhost:8788
```

Holders' token settings are in `config/token.json`. While `mint` is empty the site runs in TEST MODE.
`DECISIONS.md` explains the choices the brief left open.
