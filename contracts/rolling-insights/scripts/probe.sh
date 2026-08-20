#!/usr/bin/env bash
# =============================================================================
# Rolling Insights fixture probe — ONE-TIME capture tool.
#
# NOT for runtime. Runtime polling lives in the ingestion worker.
# Purpose: capture a real response ONCE per endpoint x sport, commit it to
# fixtures/, and thereby make future live probing unnecessary.
#
# Usage:
#   ./probe.sh <endpoint> <SPORT> [league|game_id] [date]
#
# Examples:
#   ./probe.sh live         NFL
#   ./probe.sh live         SOCCER  EPL
#   ./probe.sh play-by-play NFL     20251009-32-21
#   ./probe.sh injuries     NFL
#   ./probe.sh schedule     NCAAFB  ""  2026-09-05
#
# Requires: RSC_TOKEN in env, curl, jq
# =============================================================================
set -euo pipefail

BASE_URL="${ROLLING_INSIGHTS_BASE_URL:-https://rest.datafeeds.rolling-insights.com/api/v1}"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/fixtures"

if [[ -z "${RSC_TOKEN:-}" ]]; then
  echo "ERROR: RSC_TOKEN not set. export RSC_TOKEN='...'" >&2
  exit 1
fi

ENDPOINT="${1:?usage: probe.sh <endpoint> <SPORT> [league|game_id] [date]}"
SPORT_RAW="${2:?missing SPORT}"
EXTRA="${3:-}"
DATE_ARG="${4:-$(date +%F)}"

# --- normalize sport code (see ENDPOINTS.yaml sports.normalization) -----------
normalize_sport() {
  local s
  s="$(echo "$1" | tr '[:lower:]' '[:upper:]' | tr -d ' _')"
  case "$s" in
    NCAAF|CFB|NCAAFOOTBALL) echo "NCAAFB" ;;
    NCAAB|CBB)              echo "NCAABB" ;;
    EPL|LALIGA|SERIEA)      echo "SOCCER" ;;   # league passed via $EXTRA
    *)                      echo "$s" ;;
  esac
}
SPORT="$(normalize_sport "$SPORT_RAW")"

# --- build URL ---------------------------------------------------------------
BUSTER="$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || date +%s000)"
QS="RSC_token=${RSC_TOKEN}&_=${BUSTER}"
LEAGUE=""

case "$ENDPOINT" in
  live|schedule|schedule-week)
    PATH_SEG="/${ENDPOINT}/${DATE_ARG}/${SPORT}" ;;
  schedule-season)
    PATH_SEG="/schedule-season/${DATE_ARG%%-*}/${SPORT}" ;;
  play-by-play)
    case "$SPORT" in
      MLB|NBA|NFL) ;;
      *) echo "ERROR: play-by-play is documented for MLB, NBA, NFL only. Got ${SPORT}." >&2
         echo "       See ENDPOINTS.yaml support_matrix. This is a WONTFIX in GAPS.md." >&2
         exit 2 ;;
    esac
    [[ -z "$EXTRA" ]] && { echo "ERROR: play-by-play requires a game_id as arg 3" >&2; exit 1; }
    PATH_SEG="/play-by-play/${SPORT}"; QS="${QS}&game_id=${EXTRA}" ;;
  field)
    [[ "$SPORT" != "PGA" ]] && { echo "ERROR: field is PGA only" >&2; exit 2; }
    PATH_SEG="/field/PGA"; QS="${QS}&game_id=${EXTRA}" ;;
  events)
    PATH_SEG="/events/${DATE_ARG}/${SPORT}" ;;
  injuries|depth-charts)
    case "$SPORT" in
      MLB|NFL|NBA|NHL) ;;
      *) echo "ERROR: ${ENDPOINT} is documented for MLB/NFL/NBA/NHL only. Got ${SPORT}." >&2
         echo "       Probing anyway would resolve GAPS.md G-10 — pass FORCE=1 to override." >&2
         [[ "${FORCE:-0}" != "1" ]] && exit 2 ;;
    esac
    PATH_SEG="/${ENDPOINT}/${SPORT}" ;;
  team-info|player-info)
    PATH_SEG="/${ENDPOINT}/${SPORT}" ;;
  team-stats|player-stats)
    PATH_SEG="/${ENDPOINT}/${DATE_ARG%%-*}/${SPORT}" ;;
  *)
    echo "ERROR: unknown endpoint '${ENDPOINT}'. See ENDPOINTS.yaml." >&2; exit 1 ;;
esac

# Soccer: league is a QUERY param, and the RESPONSE is keyed by league.
if [[ "$SPORT" == "SOCCER" ]]; then
  LEAGUE="$(echo "${EXTRA:-EPL}" | tr '[:lower:]' '[:upper:]')"
  QS="${QS}&league=${LEAGUE}"
fi

URL="${BASE_URL}${PATH_SEG}?${QS}"
REDACTED="${BASE_URL}${PATH_SEG}?RSC_token=***REDACTED***&_=${BUSTER}"
[[ -n "$LEAGUE" ]] && REDACTED="${REDACTED}&league=${LEAGUE}"
echo "GET ${REDACTED}" >&2   # never echo the real URL — it holds the token

# --- fetch (cache-busted; 304 = retry once, NOT success) ---------------------
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
do_fetch() {
  curl -sS -w '%{http_code}' -o "$TMP" \
    -H 'Accept: application/json' \
    -H 'Cache-Control: no-cache, no-store' \
    -H 'Pragma: no-cache' \
    "$1"
}
CODE="$(do_fetch "$URL" || true)"

if [[ "$CODE" == "304" ]]; then
  echo "304 received — cache artifact, not success. Retrying with fresh buster..." >&2
  BUSTER="$(python3 -c 'import time;print(int(time.time()*1000))')"
  CODE="$(do_fetch "${URL/&_=*/&_=$BUSTER}" || true)"
fi

if [[ "$CODE" != "200" ]]; then
  echo "HTTP ${CODE}. Body:" >&2; head -c 500 "$TMP" >&2; echo >&2
  exit 1
fi

jq -e . "$TMP" >/dev/null 2>&1 || { echo "ERROR: response is not valid JSON" >&2; exit 1; }

# --- report what we learned --------------------------------------------------
KEY="${SPORT}"; [[ -n "$LEAGUE" ]] && KEY="$LEAGUE"   # soccer keys by league
COUNT="$(jq -r --arg k "$KEY" '(.data[$k] // []) | length' "$TMP")"

echo "--- envelope ---" >&2
echo "expected key: data.${KEY}" >&2
echo "row count:    ${COUNT}" >&2
echo "top-level keys present: $(jq -r '.data | keys | join(", ")' "$TMP" 2>/dev/null || echo '?')" >&2

if [[ "$COUNT" == "0" ]]; then
  echo >&2
  echo "⚠️  EMPTY RESULT. This is ambiguous and is the root cause of re-probing." >&2
  echo "    Probe on a GAME DAY for this sport, or the fixture teaches you nothing." >&2
  echo "    Recording the empty result anyway so it is not rediscovered." >&2
else
  echo "--- discovered fields (first row) ---" >&2
  jq -r --arg k "$KEY" '.data[$k][0] | paths(scalars) | join(".")' "$TMP" 2>/dev/null | sort -u >&2 || true
fi

# --- write fixture -----------------------------------------------------------
mkdir -p "$FIXTURE_DIR"
NAME="${ENDPOINT}.${SPORT}"; [[ -n "$LEAGUE" ]] && NAME="${NAME}.${LEAGUE}"
OUT="${FIXTURE_DIR}/${NAME}.json"
jq '.' "$TMP" > "$OUT"

echo >&2
echo "✅ fixture written: ${OUT}" >&2
echo >&2
echo "NEXT STEPS (all in ONE commit, or this probe will be repeated):" >&2
echo "  1. git add ${OUT}" >&2
echo "  2. Update ENDPOINTS.yaml -> fields.${SPORT} with the field list above" >&2
echo "  3. Mark the relevant GAPS.md row RESOLVED with this fixture path" >&2
echo "  4. INSERT into ri.contract_probe_log" >&2

cat "$TMP"
