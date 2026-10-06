#!/usr/bin/env bash
# One-time contract fixture capture. Requires explicit approval before execution.
# Move this into contracts/cfbd/scripts/probe.sh alongside its contract and fixtures.
set -euo pipefail
set +x
mode="${1:?usage: probe.sh stat-types | game-stats GAME_ID}"
key="${CFBD_API_KEY:-${CFBD_KEY:-${COLLEGE_FOOTBALL_DATA_API_KEY:-}}}"
[[ -n "$key" ]] || { echo "Missing CFBD credential" >&2; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$root/fixtures"
case "$mode" in
 stat-types) path='/plays/stats/types'; target='play-stat-types.json' ;;
 game-stats)
  game="${2:?game ID required}"
  [[ "$game" =~ ^[0-9]+$ ]] || { echo "Invalid game ID" >&2; exit 1; }
  path="/plays/stats?gameId=$game"; target="play-stats-game-$game.json" ;;
 *) echo "Unsupported capture mode" >&2; exit 1 ;;
esac
[[ ! -e "$root/fixtures/$target" ]] || { echo "Fixture exists; refusing duplicate capture" >&2; exit 1; }
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
status="$(curl --silent --show-error --max-time 45 --output "$body" --write-out '%{http_code}' --header "Authorization: Bearer $key" --header 'Accept: application/json' "https://api.collegefootballdata.com$path")"
[[ "$status" == '200' ]] || { echo "CFBD capture refused: HTTP $status" >&2; exit 1; }
node --input-type=module - "$body" "$root/fixtures/$target" "$mode" <<'JS'
import fs from 'node:fs';
const [source,destination,mode]=process.argv.slice(2);
const value=JSON.parse(fs.readFileSync(source,'utf8'));
if(!Array.isArray(value)||value.length===0)throw new Error('Empty or invalid fixture');
if(mode==='game-stats' && value.length>=2000)throw new Error('Possible provider truncation');
fs.writeFileSync(destination,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({fixture:destination.split('/').pop(),records:value.length}));
JS
