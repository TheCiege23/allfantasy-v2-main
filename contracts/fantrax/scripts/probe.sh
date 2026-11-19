#!/usr/bin/env bash
# =============================================================================
# Fantrax fixture probe — ONE-TIME capture tool, NOT for runtime.
#
# Captures `getLeagueInfo`, `getTeamRosters` and `getStandings` for ONE league from Fantrax's
# unauthenticated `fxea/general` API, prints every key path it returned (so a question like F-14's
# "is there a team logo field at all" is answered by the capture itself), and writes ONE redacted
# fixture under ../fixtures/. Commit the fixture in the same change, or this probe gets repeated.
#
# Usage:
#   contracts/fantrax/scripts/probe.sh <leagueId> <label>
#   e.g.  contracts/fantrax/scripts/probe.sh v2kzedypmm8jp61b cfb-logos-2026
#
# ⚠ Use a league the owner has consented to publishing (their own), never a random public one.
#   League ids are CASE-SENSITIVE; never change the case of one (see lib/league-import/fantrax/fantraxApi.ts).
# ⚠ Fantrax answers HTTP 200 for errors — a missing league is `{"error":{…}}` with a 200 — so the
#   body is checked, not only the status.
#
# What is redacted before anything is written: the league id and name, every team id and name
# (replaced consistently across all three endpoints by team01, team02, …), and the player pool
# (`playerInfo`, kept as a count plus one entry). Any value that is a URL keeps its host and file
# extension and loses its path, so the fixture shows WHERE a logo lives and that one exists without
# publishing anyone's uploaded image. Roster items are trimmed to two per team.
#
# Requires: curl, node. No credential of any kind.
# =============================================================================
set -euo pipefail

BASE_URL="https://www.fantrax.com/fxea/general"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/fixtures"
if [[ "${1:-}" == "--epl-player-ids" ]]; then
  # This public directory contains player data only. Retain one sample per
  # position and team so the fixture documents the ID and club vocabularies.
  body="$(mktemp)"
  trap 'rm -f "$body"' EXIT
  curl --fail --silent --show-error --max-time 60 \
    --output "$body" -H 'Accept: application/json' "$BASE_URL/getPlayerIds?sport=EPL"
  node - "$body" "$FIXTURE_DIR/epl-player-ids.json" <<'NODE'
const fs = require('node:fs')
const response = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
if (!response || Array.isArray(response) || response.error) throw new Error('Expected a public EPL player directory')
const byTeam = new Map(), positions = new Set()
const sample = {}
for (const [id, row] of Object.entries(response)) {
  if (row?.fantraxId !== id || typeof row.name !== 'string' ||
      typeof row.team !== 'string' || typeof row.position !== 'string') continue
  if (!byTeam.has(row.team) || !positions.has(row.position)) {
    byTeam.set(row.team, true)
    positions.add(row.position)
    sample[id] = { fantraxId: id, name: row.name, team: row.team, position: row.position }
  }
}
if (!Object.keys(sample).length) throw new Error('EPL directory does not have the expected player fields')
fs.writeFileSync(process.argv[3], JSON.stringify(sample, null, 2) + '\n')
console.log(JSON.stringify({ rows: Object.keys(response).length, teams: [...byTeam.keys()], positions: [...positions] }))
NODE
  exit 0
fi

LEAGUE_ID="${1:?usage: probe.sh <leagueId> <label> | --epl-player-ids}"
LABEL="${2:?missing label, e.g. cfb-logos-2026}"

if ! [[ "$LEAGUE_ID" =~ ^[a-z0-9]+$ ]]; then
  echo "ERROR: a Fantrax league id is lowercase letters and digits, got '${LEAGUE_ID}'." >&2
  exit 1
fi
if ! [[ "$LABEL" =~ ^[a-z0-9-]+$ ]]; then
  echo "ERROR: label must be lowercase letters, digits and dashes, got '${LABEL}'." >&2
  exit 1
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
for ep in getLeagueInfo getTeamRosters getStandings; do
  URL="${BASE_URL}/${ep}?leagueId=${LEAGUE_ID}"
  echo "GET ${BASE_URL}/${ep}?leagueId=<withheld>" >&2
  CODE="$(curl -sS --max-time 60 -w '%{http_code}' -o "$TMP/$ep.json" -H 'Accept: application/json' "$URL" || true)"
  if [[ "$CODE" != "200" ]]; then
    echo "HTTP ${CODE} from ${ep}. Body:" >&2; head -c 300 "$TMP/$ep.json" >&2; echo >&2
    exit 1
  fi
done

OUT="${FIXTURE_DIR}/${LABEL}.json"
mkdir -p "$FIXTURE_DIR"
node "$(dirname "${BASH_SOURCE[0]}")/redact-capture.mjs" "$TMP" "$LEAGUE_ID" "$OUT" "$BASE_URL"

echo >&2
echo "✅ fixture written: ${OUT}" >&2
echo "   Read it in full before committing, then commit it in the same change as the GAPS.md update." >&2
