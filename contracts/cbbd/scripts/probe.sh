#!/usr/bin/env bash
# CollegeBasketballData (CBBD) — one-time contract fixture capture. NOT for runtime.
#
# Exists to settle GAPS.md B-01 (can an NBA draft pick be linked to our college player by id) with
# real responses committed to ../fixtures, so nobody has to call CBBD again to learn a shape.
# CBBD is CFBD's sister API: the SAME key and the SAME monthly call quota cover both, so every
# call here spends football's budget too. Keep captures few.
#
# Usage:
#   ./probe.sh draft-picks <YEAR>            # GET /draft/picks?year=YEAR
#   ./probe.sh roster <SEASON> <TEAM>        # GET /teams/roster?season=SEASON&team=TEAM
#
# The key is read from CFBD_API_KEY / CFBD_KEY / COLLEGE_FOOTBALL_DATA_API_KEY (lib/cfbd-env.ts)
# and only ever sent as a header. It never reaches a fixture, a log line or this script's output.
set -euo pipefail
set +x
mode="${1:?usage: probe.sh draft-picks YEAR | roster SEASON TEAM}"
key="${CFBD_API_KEY:-${CFBD_KEY:-${COLLEGE_FOOTBALL_DATA_API_KEY:-}}}"
key="${key%\"}"; key="${key#\"}"
[[ -n "$key" ]] || { echo "Missing CFBD/CBBD credential" >&2; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$root/fixtures"
case "$mode" in
  draft-picks)
    year="${2:?year required}"; [[ "$year" =~ ^[0-9]{4}$ ]] || { echo "Invalid year" >&2; exit 1; }
    path="/draft/picks?year=$year"; target="draft-picks-$year.json" ;;
  roster)
    season="${2:?season required}"; team="${3:?team required}"
    [[ "$season" =~ ^[0-9]{4}$ ]] || { echo "Invalid season" >&2; exit 1; }
    [[ "$team" =~ ^[A-Za-z0-9\ \.\&\'-]+$ ]] || { echo "Invalid team" >&2; exit 1; }
    slug="$(echo "$team" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed 's/-*$//')"
    enc="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$team")"
    path="/teams/roster?season=$season&team=$enc"; target="roster-$season-$slug.json" ;;
  *) echo "Unsupported capture mode" >&2; exit 1 ;;
esac
[[ ! -e "$root/fixtures/$target" ]] || { echo "Fixture exists; refusing duplicate capture" >&2; exit 1; }
body="$(mktemp)"; headers="$(mktemp)"
trap 'rm -f "$body" "$headers"' EXIT
status="$(curl --silent --show-error --max-time 45 --dump-header "$headers" --output "$body" --write-out '%{http_code}' \
  --header "Authorization: Bearer $key" --header 'Accept: application/json' "https://api.collegebasketballdata.com$path")"
remaining="$(grep -i '^x-calllimit-remaining:' "$headers" | tr -d '\r' | awk '{print $2}' || true)"
[[ "$status" == '200' ]] || { echo "CBBD capture refused: HTTP $status (calls left: ${remaining:-unknown})" >&2; exit 1; }
node --input-type=module - "$body" "$root/fixtures/$target" "$path" <<'JS'
import fs from 'node:fs';
const [source, destination, path] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(source, 'utf8'));
const empty = Array.isArray(value) ? value.length === 0 : value == null;
if (empty) throw new Error('Empty response; not writing a fixture');
const doc = { _probe: { path, capturedAt: new Date().toISOString().slice(0, 10) }, response: value };
fs.writeFileSync(destination, JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ fixture: destination.split('/').pop(), records: Array.isArray(value) ? value.length : 1 }));
JS
echo "CBBD calls left after this capture: ${remaining:-unknown}"
