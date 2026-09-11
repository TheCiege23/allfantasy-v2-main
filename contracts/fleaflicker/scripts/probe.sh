#!/usr/bin/env bash
# =============================================================================
# Fleaflicker fixture probe — ONE-TIME capture tool.
#
# NOT for runtime. This exists to capture a real response ONCE per endpoint,
# commit it to fixtures/, and thereby make future live probing unnecessary —
# see ../README.md for why. Every probe here writes network results, which
# real people's real fantasy-league data. Prefer a league your own account can
# see over a random public one (Fleaflicker requires no auth to read any
# league, but that does not make every league equally fair game to publish
# into a public repo's fixtures).
#
# Usage:
#   ./probe.sh <endpoint> <SPORT> <league_id> [season] [scoring_period]
#
# Examples:
#   ./probe.sh standings NFL 206154
#   ./probe.sh rosters   NFL 206154 2026
#   ./probe.sh scoreboard NFL 206154 2026 1
#
# Requires: curl, jq. No credential of any kind — see ENDPOINTS.yaml auth: none.
# =============================================================================
set -euo pipefail

BASE_URL="https://www.fleaflicker.com/api"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/fixtures"

ENDPOINT="${1:?usage: probe.sh <endpoint> <SPORT> <league_id> [season] [scoring_period]}"
SPORT_RAW="${2:?missing SPORT}"
LEAGUE_ID="${3:?missing league_id}"
SEASON="${4:-$(date +%Y)}"
SCORING_PERIOD="${5:-}"

SPORT="$(echo "$SPORT_RAW" | tr '[:lower:]' '[:upper:]')"
case "$SPORT" in
  NFL|MLB|NBA|NHL) ;;
  *)
    echo "ERROR: sport '${SPORT}' is outside this codebase's accepted set (NFL/MLB/NBA/NHL)." >&2
    echo "       See ENDPOINTS.yaml common_query_params.sport — that set is OUR parser's" >&2
    echo "       choice, not necessarily Fleaflicker's own limit. Pass FORCE=1 to probe anyway." >&2
    [[ "${FORCE:-0}" != "1" ]] && exit 2
    ;;
esac

if ! [[ "$LEAGUE_ID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: league_id must be a positive integer, got '${LEAGUE_ID}'." >&2
  exit 1
fi

case "$ENDPOINT" in
  standings) PATH_SEG="/FetchLeagueStandings" ;;
  rosters)   PATH_SEG="/FetchLeagueRosters" ;;
  scoreboard)
    # 🛑 UNVERIFIED PATH — see GAPS.md G-01. This is the whole reason to run this probe.
    PATH_SEG="/FetchLeagueScoreboard"
    ;;
  *)
    echo "ERROR: unknown endpoint '${ENDPOINT}'. See ENDPOINTS.yaml." >&2
    echo "       Known: standings, rosters, scoreboard." >&2
    exit 1
    ;;
esac

QS="sport=${SPORT}&league_id=${LEAGUE_ID}&season=${SEASON}"
[[ -n "$SCORING_PERIOD" ]] && QS="${QS}&scoring_period=${SCORING_PERIOD}"

URL="${BASE_URL}${PATH_SEG}?${QS}"
echo "GET ${URL}" >&2   # nothing secret here — no token exists for this API

# --- fetch --------------------------------------------------------------------
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
CODE="$(curl -sS -w '%{http_code}' -o "$TMP" -H 'Accept: application/json' "$URL" || true)"

if [[ "$CODE" == "404" ]]; then
  echo "404 — no such league (or, for 'scoreboard', possibly no such ENDPOINT: that is" >&2
  echo "exactly what G-01 needs answered). Body:" >&2
  head -c 500 "$TMP" >&2; echo >&2
  exit 1
fi

if [[ "$CODE" != "200" ]]; then
  echo "HTTP ${CODE}. Body:" >&2; head -c 500 "$TMP" >&2; echo >&2
  exit 1
fi

# 🛑 A MISSING `jq` USED TO BE REPORTED AS "the response is not valid JSON", WHICH BLAMES
# FLEAFLICKER FOR A TOOL THIS BOX DOES NOT HAVE. `jq` is absent from this repo's Git Bash;
# `jq -e .` then exits 127 (command not found), the `||` below caught it exactly as it catches
# a parse failure, and the probe told you the provider had returned garbage. That is the same
# shape CLAUDE.md records for a missing `pgrep` — a status that is neither 0 nor 1 is not a
# verdict — and here it would have sent someone to file a provider gap that does not exist.
#
# Checked separately, and named, BEFORE the status of the parse can be confused with it.
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is not installed, so this script cannot parse or write the fixture." >&2
  echo "       This is a TOOLING problem on this machine, NOT a provider response problem —" >&2
  echo "       the HTTP request above already returned ${CODE}. Install jq, or capture the" >&2
  echo "       fixture with node:" >&2
  echo "         curl -sS -H 'Accept: application/json' \"\$URL\" -o raw.json" >&2
  echo "         node -e \"const f=require('fs');f.writeFileSync('out.json',JSON.stringify(JSON.parse(f.readFileSync('raw.json','utf8')),null,2)+'\\n')\"" >&2
  exit 3
fi

jq -e . "$TMP" >/dev/null 2>&1 || { echo "ERROR: response is not valid JSON" >&2; exit 1; }

# --- report what we learned ----------------------------------------------------
echo "--- top-level keys ---" >&2
jq -r 'keys | join(", ")' "$TMP" >&2
echo "--- discovered fields (flattened, deduped) ---" >&2
jq -r '[paths(scalars)] | map(join(".")) | unique | .[]' "$TMP" 2>/dev/null | sort -u >&2 || true

# --- write fixture --------------------------------------------------------------
mkdir -p "$FIXTURE_DIR"
NAME="${ENDPOINT}.${SPORT}"
[[ -n "$SCORING_PERIOD" ]] && NAME="${NAME}.week${SCORING_PERIOD}"
OUT="${FIXTURE_DIR}/${NAME}.json"
jq '.' "$TMP" > "$OUT"

echo >&2
echo "✅ fixture written: ${OUT}" >&2
echo >&2
echo "⚠ THIS IS REAL DATA FROM A REAL LEAGUE. Before committing, check the fixture for" >&2
echo "  anything you would not want in a public repo (full names are expected and normal" >&2
echo "  for a fantasy scoreboard; look for anything beyond that)." >&2
echo >&2
echo "NEXT STEPS (all in ONE commit, or this probe will be repeated):" >&2
echo "  1. git add ${OUT}" >&2
echo "  2. Update ENDPOINTS.yaml -> endpoints.FetchLeagueScoreboard with the real path/" >&2
echo "     params/fields/status: INTEGRATED (only if this WAS the scoreboard endpoint —" >&2
echo "     if it 404'd or came back shaped like something else, record THAT in GAPS.md" >&2
echo "     instead, per G-02)." >&2
echo "  3. Mark GAPS.md G-01 (and any of G-03..G-06 this fixture happens to answer) RESOLVED" >&2
echo "     with this fixture path as the source." >&2

cat "$TMP"
