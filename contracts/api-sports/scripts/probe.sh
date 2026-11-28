#!/usr/bin/env bash
# =============================================================================
# API-Sports American Football fixture probe — ONE-TIME capture tool. NOT runtime.
#
# Usage:
#   ./probe.sh <fixture-name> <endpoint> [key=val ...]
#
# Example (the capture this script was written for, 2026-11-22):
#   set -a; . ./.env.local; set +a
#   contracts/api-sports/scripts/probe.sh injuries-nfl-team-2 injuries team=2
#
# Writes contracts/api-sports/fixtures/<fixture-name>.json. Commit it in the same
# change as the code that depends on it (root CLAUDE.md probing rule).
#
# Before the real request it calls `/status`, which the vendor documents as NOT
# counting against the daily quota, and prints the plan name, whether it is
# active, and today's request count. That is the only way to know which plan the
# key you are holding is on.
#
# 🛑 SECRETS. The key goes in the `x-apisports-key` HEADER via a 0600 temp file
# (`curl -H @file`), so it is in neither the URL nor any process's argv, and it is
# never printed. `/status` also returns the account holder's name and email; they
# are read and discarded.
#
# Requires: curl, node (for JSON parsing — jq is not installed in this repo's Git Bash).
# Exit: 0 ok, 2 usage/key, 1 non-JSON body, 3 a populated `errors` object
# (API-Sports answers HTTP 200 for plan and parameter refusals).
# =============================================================================
set -euo pipefail

BASE="https://v1.american-football.api-sports.io"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/fixtures"

# Same alias list as getApiSportsKey() in lib/api-sports.ts, same order.
KEY="${APISPORTS_API_KEY:-${APISPORTS_KEY:-${API_SPORTS_KEY:-${SPORTS_API_KEY:-}}}}"

NAME="${1:?usage: probe.sh <fixture-name> <endpoint> [key=val ...]}"
ENDPOINT="${2:?missing endpoint}"
shift 2
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "fixture-name: lowercase letters, digits, dashes" >&2; exit 2; }
[[ -n "$KEY" ]] || { echo "no API-Sports key in APISPORTS_API_KEY / APISPORTS_KEY / API_SPORTS_KEY / SPORTS_API_KEY" >&2; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
umask 077
printf 'x-apisports-key: %s\n' "$KEY" > "$TMP/h"
unset KEY

# --- 1. which plan is this key on (free call) --------------------------------
SCODE="$(curl -sS -w '%{http_code}' -o "$TMP/status.json" -H @"$TMP/h" "$BASE/status" || true)"
node -e '
  const b = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const s = b?.response?.subscription ?? {}, r = b?.response?.requests ?? {};
  console.error(`status: HTTP ${process.argv[2]}  plan=${s.plan ?? "?"}  active=${s.active ?? "?"}  requests today=${r.current ?? "?"}/${r.limit_day ?? "?"}`);
' "$TMP/status.json" "$SCODE" || echo "status: HTTP $SCODE (unparseable)" >&2

# --- 2. the request being captured -------------------------------------------
QS=""
for kv in "$@"; do
  [[ "$kv" == *=* && "${kv%%=*}" != "" ]] || { echo "bad param: $kv" >&2; exit 2; }
  QS="${QS}&${kv}"
done
QS="${QS#&}"
URL="${BASE}/${ENDPOINT#/}${QS:+?$QS}"
echo "GET ${URL}  (x-apisports-key: ***REDACTED***)" >&2
CODE="$(curl -sS -w '%{http_code}' -D "$TMP/headers" -o "$TMP/body.json" -H @"$TMP/h" "$URL" || true)"

mkdir -p "$FIXTURE_DIR"
OUT="$FIXTURE_DIR/$NAME.json"
set +e
node -e '
  const fs = require("fs");
  const [file, out, code, hdrs] = process.argv.slice(1);
  let b;
  try { b = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { console.error(`HTTP ${code}, body is not JSON: ${fs.readFileSync(file, "utf8").slice(0, 300)}`); process.exit(1); }
  const e = b.errors;
  const hasErr = e && !Array.isArray(e) && Object.keys(e).length > 0;
  const rem = (fs.readFileSync(hdrs, "utf8").match(/^x-ratelimit-requests-remaining:\s*(\d+)/im) || [])[1] ?? "?";
  const n = Array.isArray(b.response) ? b.response.length : "?";
  console.error(`HTTP ${code}  results=${b.results ?? "?"}  response.length=${n}  errors=${hasErr ? JSON.stringify(e) : "none"}  day-remaining=${rem}`);
  fs.writeFileSync(out, JSON.stringify(b, null, 2) + "\n");
  console.error(`wrote ${out}`);
  process.exit(hasErr ? 3 : 0);
' "$TMP/body.json" "$OUT" "$CODE" "$TMP/headers"
exit $?
