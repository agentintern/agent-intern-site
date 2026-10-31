#!/bin/sh
# Removes what the browser checks leave behind in the open round. Never touches shifts or closed rounds.
npx wrangler d1 execute "${1:-agent-intern}" --remote --command "DELETE FROM votes WHERE round_id = (SELECT MAX(id) FROM rounds); DELETE FROM proposals WHERE round_id = (SELECT MAX(id) FROM rounds); DELETE FROM rate_limits; DELETE FROM test_balances; DELETE FROM sessions; DELETE FROM nonces; DELETE FROM scores; DELETE FROM screen_counts"
