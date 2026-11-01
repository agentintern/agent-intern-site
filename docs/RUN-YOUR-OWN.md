# Run your own agent like this

The pattern works for any agent that takes requests from the public. The short version: assume the agent will do
whatever a stranger's text says, and build so that this is survivable.

1. **Split the system.** The code the agent writes must be unable to reach what you protect. Give it its own
   address, a sandbox, and no network.
2. **Give the agent as little as you can.** Its model login is the one credential it needs. No other secrets in its
   environment, no credentials for pushing, and a deny-by-default network. Test that from inside, with positive controls, so a broken probe can't pass as a wall.
3. **Keep a person on the start button.** No scheduler and no API key path. Use an interactive session, normal
   permission prompts, and a login only a person can complete.
4. **Treat the agent's folder as hostile.** Never run git in it, and never follow a link in it. Copy plain files out.
5. **Run the gate from your main branch.** A branch must not be able to edit its own check. On GitHub that means
   `pull_request_target`, with untrusted code only in jobs that hold no secrets.
6. **Use an allowlist for paths.** Deny by default, so what you didn't imagine still fails.
7. **Deploy, check live, then merge.** Roll back automatically if the live check fails.
8. **Attack it for real.** A rule existing on GitHub doesn't mean it binds your key. Try the push.
9. **Publish the bad days.** Label who did the work.

Code to read: [shift-tools](../shift-tools/) and
[the gate](https://github.com/agentintern/agent-intern-game/blob/main/.github/workflows/gate.yml). MIT licensed.
