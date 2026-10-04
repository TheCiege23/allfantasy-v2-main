#!/usr/bin/env bash
# =============================================================================
# ESPN site-API fixture probe — ONE-TIME capture tool.
#
# NOT for runtime. This exists to capture a real response ONCE per endpoint/sport,
# commit it to fixtures/, and thereby make future live probing unnecessary — see
# ../README.md. ESPN publishes no API, no docs and no rate limits, so every call
# here is a call against an undocumented surface that has blocked us once already
# (lib/providers/espnUrls.ts). Keep probes few.
#
# Usage:
#   ./probe.sh teams  <SPORT>
#   ./probe.sh roster <SPORT> <espn_team_id>
#   ./probe.sh fantasy-league MLB <league_id> <season>
#
# Examples:
#   ./probe.sh teams  NCAAB
#   ./probe.sh roster NCAAB 150
#
# Requires: curl, and jq OR node. No credential of any kind — ESPN's site API needs none.
#
# 🛑 NO SPOOFED HEADERS. If this returns 403, record it in GAPS.md and stop. Do not add a
# browser user-agent, referer or origin to get past it — see lib/providers/espnUrls.ts.
# =============================================================================
set -euo pipefail

# Must equal ESPN_SITE_API_BASE in lib/providers/espnUrls.ts — the host moved once
# (site.api.espn.com -> site.web.api.espn.com, 2026-08-22) and the old one 403s.
BASE_URL="https://site.web.api.espn.com/apis/site/v2/sports"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/fixtures"

ENDPOINT="${1:?usage: probe.sh <teams|roster|fantasy-league> <SPORT> [id] [season]}"
SPORT_RAW="${2:?missing SPORT}"
TEAM_ID="${3:-}"
SEASON="${4:-}"

SPORT="$(echo "$SPORT_RAW" | tr '[:lower:]' '[:upper:]')"
case "$SPORT" in
  NCAAB) SPORT_PATH="basketball/mens-college-basketball" ;;
  MLB)
    if [[ "$ENDPOINT" != "fantasy-league" ]]; then echo "MLB currently supports only fantasy-league capture" >&2; exit 2; fi
    SPORT_PATH="baseball/mlb"
    ;;
  *)
    echo "ERROR: sport '${SPORT}' is not in this contract yet (NCAAB only)." >&2
    echo "       Adding one is a contract change: probe it, commit the fixture, and add it" >&2
    echo "       to ENDPOINTS.yaml support_matrix in the same commit." >&2
    exit 2
    ;;
esac

case "$ENDPOINT" in
  fantasy-league)
    if [[ "$SPORT" != "MLB" ]] || ! [[ "$TEAM_ID" =~ ^[0-9]+$ && "$SEASON" =~ ^[0-9]{4}$ ]]; then
      echo "usage: probe.sh fantasy-league MLB <public_league_id> <season>" >&2; exit 2
    fi
    BASE_URL="https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb"
    PATH_SEG="/seasons/${SEASON}/segments/0/leagues/${TEAM_ID}"
    QS="view=mTeam&view=mRoster&view=mSettings&view=mMatchup&view=mDraftDetail"
    NAME="fantasy-league.MLB.${SEASON}"
    ;;
  teams)
    # `limit` is required in practice: the default page is short. The value is recorded
    # in ENDPOINTS.yaml with the count it actually returned.
    PATH_SEG="/${SPORT_PATH}/teams"
    QS="limit=1000"
    NAME="teams.${SPORT}"
    ;;
  roster)
    if ! [[ "$TEAM_ID" =~ ^[0-9]+$ ]]; then
      echo "ERROR: roster needs a numeric ESPN team id (see sports[].leagues[].teams[].team.id" >&2
      echo "       in fixtures/teams.${SPORT}.json), got '${TEAM_ID}'." >&2
      exit 1
    fi
    PATH_SEG="/${SPORT_PATH}/teams/${TEAM_ID}/roster"
    QS=""
    NAME="roster.${SPORT}.team${TEAM_ID}"
    ;;
  *)
    echo "ERROR: unknown endpoint '${ENDPOINT}'. Known: teams, roster, fantasy-league. See ENDPOINTS.yaml." >&2
    exit 1
    ;;
esac

URL="${BASE_URL}${PATH_SEG}${QS:+?${QS}}"
echo "GET ${URL}" >&2   # nothing secret here — no token exists for this API

TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
CODE="$(curl -sS -w '%{http_code}' -o "$TMP" -H 'Accept: application/json' "$URL" || true)"

if [[ "$CODE" == "403" ]]; then
  echo "HTTP 403 — ESPN is blocking this host or client. Record it in GAPS.md and STOP." >&2
  echo "Do not retry with spoofed headers. Body:" >&2
  head -c 300 "$TMP" >&2; echo >&2
  exit 1
fi
if [[ "$CODE" != "200" ]]; then
  echo "HTTP ${CODE}. Body:" >&2; head -c 500 "$TMP" >&2; echo >&2
  exit 1
fi

# jq is absent from this repo's Git Bash; node is always present. Same rationale and
# output format as contracts/fleaflicker/scripts/probe.sh (2-space indent + newline).
if command -v jq >/dev/null 2>&1; then
  jq -e . "$TMP" >/dev/null 2>&1 || { echo "ERROR: response is not valid JSON" >&2; exit 1; }
  mkdir -p "$FIXTURE_DIR"; OUT="${FIXTURE_DIR}/${NAME}.json"; jq '.' "$TMP" > "$OUT"
elif command -v node >/dev/null 2>&1; then
  echo "NOTE: jq not installed; using node to parse and write the fixture." >&2
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$TMP" >/dev/null 2>&1 \
    || { echo "ERROR: response is not valid JSON" >&2; exit 1; }
  mkdir -p "$FIXTURE_DIR"; OUT="${FIXTURE_DIR}/${NAME}.json"
  node -e 'const f=require("fs");f.writeFileSync(process.argv[2],JSON.stringify(JSON.parse(f.readFileSync(process.argv[1],"utf8")),null,2)+"\n")' "$TMP" "$OUT"
else
  echo "ERROR: neither jq nor node is available. This is a TOOLING problem on this machine," >&2
  echo "       NOT a provider problem — the request above already returned ${CODE}." >&2
  exit 3
fi

echo "✅ fixture written: ${OUT} ($(wc -c < "$OUT") bytes)" >&2
echo >&2
echo "NEXT STEPS (all in ONE commit, or this probe will be repeated):" >&2
echo "  1. If large, trim to a key-union cover:" >&2
echo "       node contracts/fleaflicker/scripts/trim-fixture.mjs ${OUT}" >&2
echo "     (record any count you need from the FULL body in ENDPOINTS.yaml first)." >&2
echo "  2. git add the fixture; update ENDPOINTS.yaml fields + support_matrix." >&2
echo "  3. Mark the matching GAPS.md row RESOLVED with this fixture as the source." >&2
