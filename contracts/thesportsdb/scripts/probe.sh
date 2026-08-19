#!/usr/bin/env bash
# =============================================================================
# TheSportsDB fixture probe — ONE-TIME capture tool. NOT for runtime.
#
# Usage:
#   ./probe.sh 1 <endpoint.php> [key=val ...]
#   ./probe.sh 2 </path/segments>
#
# Examples:
#   ./probe.sh 1 eventsday.php d=2026-09-13 l=4391
#   ./probe.sh 1 lookupplayerstats.php id=34201502
#   ./probe.sh 1 lookupeventstats.php id=2261187
#   ./probe.sh 2 /livescore/4391
#   ./probe.sh 2 /lookup/player_stats/34201502
#
# Requires: THESPORTSDB_API_KEY, curl, jq
# =============================================================================
set -euo pipefail

V1="https://www.thesportsdb.com/api/v1/json"
V2="https://www.thesportsdb.com/api/v2/json"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/fixtures"

KEY="${THESPORTSDB_API_KEY:-}"
if [[ -z "$KEY" ]]; then
  echo "WARN: THESPORTSDB_API_KEY not set — falling back to free key '123'." >&2
  echo "      Free tier SILENTLY TRUNCATES lists and blocks livescore/v2." >&2
  echo "      Results captured on the free key are NOT representative." >&2
  KEY="123"
  FREE_KEY=1
fi

VERSION="${1:?usage: probe.sh <1|2> <endpoint|path> [key=val ...]}"
TARGET="${2:?missing endpoint or path}"
shift 2

TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT

case "$VERSION" in
  1)
    QS=""
    for kv in "$@"; do QS="${QS}&${kv}"; done
    QS="${QS#&}"
    URL="${V1}/${KEY}/${TARGET}${QS:+?$QS}"
    # ⚠️ v1 puts the key in the PATH — never echo the real URL.
    echo "GET ${V1}/***REDACTED***/${TARGET}${QS:+?$QS}" >&2
    CODE="$(curl -sS -w '%{http_code}' -o "$TMP" -H 'Accept: application/json' "$URL" || true)"
    ;;
  2)
    if [[ "${FREE_KEY:-0}" == "1" ]]; then
      echo "ERROR: v2 is PREMIUM-ONLY. Set THESPORTSDB_API_KEY to a paid key." >&2
      exit 2
    fi
    URL="${V2}${TARGET}"
    echo "GET ${URL}  (X-API-KEY: ***REDACTED***)" >&2
    CODE="$(curl -sS -w '%{http_code}' -o "$TMP" \
      -H 'Accept: application/json' -H "X-API-KEY: ${KEY}" "$URL" || true)"
    ;;
  *) echo "ERROR: version must be 1 or 2" >&2; exit 1 ;;
esac

echo "HTTP ${CODE}" >&2

# --- v1 returns 200 ON ERRORS. Check the body, not the status. ---------------
if ! jq -e . "$TMP" >/dev/null 2>&1; then
  echo "ERROR: response is not valid JSON:" >&2; head -c 400 "$TMP" >&2; echo >&2
  exit 1
fi

API_MSG="$(jq -r '.Message // empty' "$TMP")"   # note the CAPITAL M
if [[ -n "$API_MSG" ]]; then
  echo "⚠️  API ERROR (returned as HTTP ${CODE}): ${API_MSG}" >&2
  echo "    v1 returns 200 on errors. Never trust the status code alone." >&2
fi

# --- envelope analysis ------------------------------------------------------
TOP_KEY="$(jq -r 'keys[0] // empty' "$TMP")"
IS_NULL="$(jq -r --arg k "$TOP_KEY" '.[$k] == null' "$TMP")"
COUNT="$(jq -r --arg k "$TOP_KEY" '(.[$k] // []) | if type=="array" then length else 1 end' "$TMP")"

echo "--- envelope ---" >&2
echo "top-level key: ${TOP_KEY}" >&2
echo "value is null: ${IS_NULL}" >&2
echo "row count:     ${COUNT}" >&2

if [[ "$IS_NULL" == "true" ]]; then
  cat >&2 <<'MSG'

⚠️  NULL RESULT. This is meaningful — record it, do not retry.

    In this API, `null` means "endpoint exists but has no data for this entity".
    For NFL, event_stats / timeline / lineup are ALL confirmed null (see GAPS.md
    R-01..R-03). That is a WONTFIX, not a transient failure.

    ACTION: add a row to tsdb.contract_probe_log with returned_null = true, and
    record it in GAPS.md. A recorded null is what stops the next agent from
    re-probing this exact endpoint.
MSG
elif [[ "$COUNT" != "0" ]]; then
  echo "--- discovered fields (first row) ---" >&2
  jq -r --arg k "$TOP_KEY" '
    (if (.[$k]|type)=="array" then .[$k][0] else .[$k] end)
    | paths(scalars) | join(".")' "$TMP" 2>/dev/null | sort -u >&2 || true
fi

if [[ "${FREE_KEY:-0}" == "1" && "$COUNT" != "0" ]]; then
  echo >&2
  echo "⚠️  FREE KEY: list results are silently truncated with NO indicator." >&2
  echo "    A US American-football league query on the free key omitted both" >&2
  echo "    NFL and NCAA Division 1. Do not treat this fixture as complete." >&2
fi

# --- write fixture ----------------------------------------------------------
mkdir -p "$FIXTURE_DIR"
SAFE="$(echo "v${VERSION}.${TARGET}$*" | tr -c 'A-Za-z0-9._-' '_' | sed 's/__*/_/g;s/_$//')"
OUT="${FIXTURE_DIR}/${SAFE}.json"
jq '.' "$TMP" > "$OUT"

echo >&2
echo "✅ fixture written: ${OUT}" >&2
echo >&2
echo "NEXT STEPS (one commit, or this probe gets repeated):" >&2
echo "  1. git add ${OUT}" >&2
echo "  2. INSERT INTO tsdb.contract_probe_log (... returned_null ...)" >&2
echo "  3. Update ENDPOINTS.yaml objects: with the field list above" >&2
echo "  4. Move the GAPS.md row to RESOLVED or WONTFIX" >&2
echo >&2
echo "NOTE: probe NFL endpoints DURING THE SEASON. Offseason nulls are" >&2
echo "      indistinguishable from unsupported endpoints — that ambiguity is" >&2
echo "      the original cause of the re-probing loop. Record season context." >&2

cat "$TMP"
