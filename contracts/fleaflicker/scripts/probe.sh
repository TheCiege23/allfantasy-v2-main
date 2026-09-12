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

ENDPOINT="${1:?usage: probe.sh <endpoint> <SPORT> <league_id> [season] [scoring_period|draft_number]}"
SPORT_RAW="${2:?missing SPORT}"
LEAGUE_ID="${3:?missing league_id}"
SEASON="${4:-$(date +%Y)}"
# 5th positional is `scoring_period` for scoreboard/rosters and `draft_number` for
# `draft` — a draft board has no scoring period and a scoreboard has no draft number,
# so they never collide.
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
    # G-01 RESOLVED 2026-09-11 — two played-week fixtures committed. Kept probeable for
    # the gaps that remain (an unplayed week, a bye).
    PATH_SEG="/FetchLeagueScoreboard"
    ;;
  rules)
    # Endpoint NAME from Fleaflicker's own published Swagger docs, read 2026-09-12 —
    # documentation, not a probe. The SHAPE is unknown, which is what this captures.
    # Takes no season: rules are a property of the league, not of a year.
    PATH_SEG="/FetchLeagueRules"
    ;;
  activity)
    # ⚠ RETURNS REAL PEOPLE'S TRANSACTIONS. See the privacy note at the top of this file
    # before committing anything it produces — a scoreboard's team names are one thing,
    # a log of who dropped whom is another.
    PATH_SEG="/FetchLeagueActivity"
    ;;
  transactions)
    # ⚠ Same privacy consideration as `activity`.
    PATH_SEG="/FetchLeagueTransactions"
    ;;
  draft)
    # Endpoint NAME and parameter list from Fleaflicker's own published Swagger docs,
    # read 2026-09-12 — documentation, not a probe. Documented params:
    # sport, league_id, season, draft_number, external_id_type.
    #
    # ⚠ A draft board is league RESULTS — who picked whom, in what order — the same
    # category as a scoreboard, not the per-manager add/drop log G-07 holds back. It
    # still names real people's teams; read the privacy note at the top of this file.
    PATH_SEG="/FetchLeagueDraftBoard"
    ;;
  *)
    echo "ERROR: unknown endpoint '${ENDPOINT}'. See ENDPOINTS.yaml." >&2
    echo "       Known: standings, rosters, scoreboard, rules, activity, transactions, draft." >&2
    exit 1
    ;;
esac

# ⚠ NOT EVERY ENDPOINT TAKES `season`. Per Fleaflicker's published docs, FetchLeagueRules,
# FetchLeagueActivity and FetchLeagueTransactions take only sport + league_id (+ paging).
# Sending a parameter an endpoint does not accept is how a probe ends up documenting a
# response to a request nobody will ever make.
#
# 🛑 AND SENDING ONE IT DOES NOT ACCEPT IS AN HTTP 400, NOT A SILENT IGNORE — measured
# 2026-09-12 for FetchLeagueRules and FetchLeagueActivity. The two failure modes point
# opposite ways: these three 400, while standings/rosters/scoreboard ACCEPT `season`
# and silently CLAMP it past the league's last. One shared query builder breaks both.
# See ENDPOINTS.yaml `common_query_params.season`.
case "$ENDPOINT" in
  rules|activity|transactions) QS="sport=${SPORT}&league_id=${LEAGUE_ID}" ;;
  draft)
    # `draft_number` is documented and defaults to 1 here. ⚠ WITHOUT IT THE ENDPOINT
    # RETURNS HTTP 200 AND AN EMPTY OBJECT `{}` — measured on league 206154 season 2021.
    # A 200 with no keys is the worst shape to debug: it is not an error, not a 404, and
    # reads as "this league never drafted" when it means "you did not say which draft".
    QS="sport=${SPORT}&league_id=${LEAGUE_ID}&season=${SEASON}&draft_number=${SCORING_PERIOD:-1}"
    ;;
  *)
    QS="sport=${SPORT}&league_id=${LEAGUE_ID}&season=${SEASON}"
    [[ -n "$SCORING_PERIOD" ]] && QS="${QS}&scoring_period=${SCORING_PERIOD}"
    ;;
esac

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
# 🛑 AND IT USED TO EXIT 3 HERE, WHICH MADE THE ONLY SANCTIONED PROBE PATH UNUSABLE ON
# THE ONE BOX THAT USES IT. `jq` is absent from this repo's Git Bash — so the script
# correctly diagnosed the problem, printed a node one-liner, and left every capture to
# be done by hand outside the tool that exists to standardise it. A convention nobody
# can execute is a convention that gets worked around.
#
# `node` is present (this is a Next.js repo) and does the same two jobs. jq is still
# preferred when available; the fallback is byte-equivalent for our purposes —
# 2-space indent plus a trailing newline, matching `jq '.'`.
JSON_ENGINE=""
if command -v jq >/dev/null 2>&1; then
  JSON_ENGINE="jq"
elif command -v node >/dev/null 2>&1; then
  JSON_ENGINE="node"
  echo "NOTE: jq not installed; using node to parse and write the fixture." >&2
else
  echo "ERROR: neither jq nor node is available, so this script cannot parse or write" >&2
  echo "       the fixture. This is a TOOLING problem on this machine, NOT a provider" >&2
  echo "       response problem — the HTTP request above already returned ${CODE}." >&2
  exit 3
fi

# Validate + pretty-print + flatten, through whichever engine we have. Kept in one
# place so the two paths cannot drift.
json_check() {   # exits non-zero when the body is not valid JSON
  if [[ "$JSON_ENGINE" == "jq" ]]; then jq -e . "$1" >/dev/null 2>&1
  else node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$1" >/dev/null 2>&1; fi
}
json_keys() {
  if [[ "$JSON_ENGINE" == "jq" ]]; then jq -r 'keys | join(", ")' "$1"
  else node -e 'const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(Object.keys(o).join(", "))' "$1"; fi
}
json_paths() {
  if [[ "$JSON_ENGINE" == "jq" ]]; then jq -r '[paths(scalars)] | map(join(".")) | unique | .[]' "$1" 2>/dev/null
  else node -e '
    const o=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const out=new Set();
    (function w(v,p){ if(v&&typeof v==="object"){ if(Array.isArray(v)) v.forEach((x,i)=>w(x,p+"."+i));
      else for(const k of Object.keys(v)) w(v[k],p?p+"."+k:k); } else out.add(p); })(o,"");
    [...out].sort().forEach(x=>console.log(x));' "$1" 2>/dev/null; fi
}
json_write() {   # $1 = source, $2 = destination
  if [[ "$JSON_ENGINE" == "jq" ]]; then jq '.' "$1" > "$2"
  else node -e 'const f=require("fs");f.writeFileSync(process.argv[2],JSON.stringify(JSON.parse(f.readFileSync(process.argv[1],"utf8")),null,2)+"\n")' "$1" "$2"; fi
}

json_check "$TMP" || { echo "ERROR: response is not valid JSON" >&2; exit 1; }

# --- report what we learned ----------------------------------------------------
echo "--- top-level keys ---" >&2
json_keys "$TMP" >&2
echo "--- discovered fields (flattened, deduped) ---" >&2
json_paths "$TMP" | sort -u >&2 || true

# --- write fixture --------------------------------------------------------------
mkdir -p "$FIXTURE_DIR"
NAME="${ENDPOINT}.${SPORT}"
# ⚠ SEASON BELONGS IN THE NAME FOR ANY ENDPOINT THAT TAKES ONE. A fixture called
# `scoreboard.NFL.week1.json` was committed labelled "season 2025" and actually held
# 2021 data, because Fleaflicker silently clamps a season past the league's last —
# see ENDPOINTS.yaml's `season` note. The file name is the first thing a reader
# trusts, so it carries the season that the payload actually describes.
case "$ENDPOINT" in
  rules|activity|transactions) ;;                       # take no season
  *) NAME="${NAME}.${SEASON}" ;;
esac
[[ -n "$SCORING_PERIOD" ]] && NAME="${NAME}.week${SCORING_PERIOD}"
OUT="${FIXTURE_DIR}/${NAME}.json"
json_write "$TMP" "$OUT"

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
