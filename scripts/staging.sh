#!/bin/sh
# Deploys a fake launch to the preview address with its own database. The real config is never touched:
# this builds from a temporary copy, and the mint in it is made up.
set -e
ROOT=$(pwd)
TMP=$(mktemp -d)
cp -R config functions public scripts src migrations package.json wrangler.jsonc "$TMP/"
ln -s "$ROOT/node_modules" "$TMP/node_modules"
cd "$TMP"
python3 -c "
import json
d=json.load(open('config/token.json'))
d['mint']='FakeMint1111111111111111111111111111111111111'
d['creatorFees']='Staging only. Nothing here is real.'
json.dump(d,open('config/token.json','w'))
s=json.load(open('config/site.json'))
s['siteOrigin']='https://staging.agent-intern.pages.dev'
json.dump(s,open('config/site.json','w'))"
npx wrangler d1 migrations apply agent-intern-staging --remote --env preview >/dev/null 2>&1 || true
node scripts/build.mjs
npx wrangler pages deploy dist --project-name agent-intern --branch staging --commit-dirty=true
cd "$ROOT"
rm -rf "$TMP"
