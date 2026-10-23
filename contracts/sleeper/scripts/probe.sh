#!/usr/bin/env bash
# =============================================================================
# Sleeper fixture probe — ONE-TIME capture tool. NOT for runtime.
#
# Captures a real response ONCE per endpoint/sport, writes a TRIMMED fixture to
# ../fixtures/, and thereby makes future live probing unnecessary. Commit the
# fixture in the same change as the probe, or the probe gets repeated (root
# CLAUDE.md, "Sports data providers").
#
# Usage:
#   ./probe.sh players <sport>
#
# Examples:
#   ./probe.sh players nba      # -> fixtures/players.nba.json
#
# Requires: curl, node. No credential of any kind — Sleeper's read API is
# unauthenticated (see ENDPOINTS.yaml auth: none), so there is nothing to redact.
#
# ⚠ THE PLAYERS FEED IS SEVERAL MB. It is streamed to a temp file OUTSIDE the
# repo and trimmed by trim-players-fixture.mjs to ~20 players plus a summary of
# the whole feed. The raw download is deleted on exit and is never committed.
# =============================================================================
set -euo pipefail

BASE_URL="https://api.sleeper.app/v1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)/fixtures"

ENDPOINT="${1:?usage: probe.sh players <sport>}"
SPORT_RAW="${2:?missing sport}"
SPORT="$(echo "$SPORT_RAW" | tr '[:upper:]' '[:lower:]')"

case "$SPORT" in
  nfl|nba) ;;
  *)
    echo "ERROR: sport '${SPORT}' is outside the set this codebase maps (nfl, nba)." >&2
    echo "       SleeperSport is 'nfl' | 'nba' and SLEEPER_ENDPOINT_SPORTS lists only NFL and NBA." >&2
    echo "       Whether Sleeper serves other sports is GAPS.md S-09's open half — record, do not guess." >&2
    exit 2
    ;;
esac

case "$ENDPOINT" in
  players) URL="${BASE_URL}/players/${SPORT}" ;;
  *)
    echo "ERROR: unknown endpoint '${ENDPOINT}'. Known: players. See ENDPOINTS.yaml." >&2
    exit 1
    ;;
esac

TMP_DIR="$(mktemp -d)"; trap 'rm -rf "$TMP_DIR"' EXIT
RAW="${TMP_DIR}/raw.json"

echo "GET ${URL}" >&2
: > "$RAW"
CODE="$(curl -sS --compressed -w '%{http_code}' -o "$RAW" -H 'Accept: application/json' "$URL" || true)"
BYTES="$(wc -c < "$RAW" | tr -d ' ')"
echo "HTTP ${CODE}, ${BYTES} bytes" >&2

# ⚠ `000` IS NOT A VENDOR ANSWER. curl prints it when no HTTP response arrived at all — DNS, TLS,
# or an egress proxy refusing the CONNECT (measured 2026-10-23 from a sandbox whose policy denies
# api.sleeper.app). Record it as "could not reach", never as anything about Sleeper's feed.
if [[ "$CODE" == "000" ]]; then
  echo "ERROR: no HTTP response (network/proxy). Nothing was learned about the feed; nothing written." >&2
  exit 3
fi

if [[ "$CODE" != "200" ]]; then
  echo "ERROR: non-200. First 400 bytes:" >&2
  head -c 400 "$RAW" >&2; echo >&2
  exit 1
fi

mkdir -p "$FIXTURE_DIR"
OUT="${FIXTURE_DIR}/${ENDPOINT}.${SPORT}.json"
node "${SCRIPT_DIR}/trim-players-fixture.mjs" "$RAW" "$OUT" \
  --sport="$SPORT" --url="$URL" --http-status="$CODE" --bytes="$BYTES"

echo >&2
echo "✅ fixture written: ${OUT}" >&2
echo "NEXT STEPS (one commit, or this probe gets repeated):" >&2
echo "  1. git add ${OUT}" >&2
echo "  2. Update ENDPOINTS.yaml with what the summary shows" >&2
echo "  3. Move the GAPS.md row to RESOLVED or WONTFIX" >&2
