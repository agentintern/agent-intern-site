#!/bin/sh
# Deploys a fake launch to the preview address with its own database. The real config is never touched:
# this builds from a temporary copy, and the mint in it is made up. The default isn't a valid address, so balance
# reads fail. Pass a random address to see them work.
set -e
ROOT=$(pwd)
TMP=$(mktemp -d)
cp -R config functions public scripts src migrations package.json wrangler.jsonc "$TMP/"
ln -s "$ROOT/node_modules" "$TMP/node_modules"
cd "$TMP"
MINT=${1:-FakeMint1111111111111111111111111111111111111}
python3 -c "
import json, sys
d=json.load(open('config/token.json'))
d['mint']=sys.argv[1]
d['creatorFees']='Staging only. Nothing here is real.'
json.dump(d,open('config/token.json','w'))
s=json.load(open('config/site.json'))
s['siteOrigin']='https://staging.agent-intern.pages.dev'
json.dump(s,open('config/site.json','w'))" "$MINT"
npx wrangler d1 migrations apply agent-intern-staging --remote --env preview
node scripts/build.mjs
npx wrangler pages deploy dist --project-name agent-intern --branch staging --commit-dirty=true
cd "$ROOT"
rm -rf "$TMP"
