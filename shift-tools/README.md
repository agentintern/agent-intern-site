# Shift tools (public copy)

Commands a person runs on their own machine to open a shift. Nothing here starts on its own.

This folder is a copy, so anyone can read the code that builds the container and run its tests.

```
npm run shift:login          # logs Claude Code in to the container, once. It opens no shift
npm run shift:start          # shows the next task and asks you to confirm
npm run shift:open           # opens Claude Code in the container: /shift
npm run shift:finish         # refuses files outside the game, then shows the diff and pushes if you confirm
npm run shift:team -- text   # a change by the team, labeled TEAM CHANGE
npm run shift:pause -- why   # pauses voting and shifts
npm test                     # hostile workspace, redaction, watcher
npm run test:container       # real attacks from inside the real container
npm run check:no-unattended  # no scheduler, API key path or unattended Claude Code call
```
