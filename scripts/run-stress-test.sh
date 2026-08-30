#!/bin/bash
# AllFantasy Legacy Stress Test - Phase 2 & 3
# Runs 1,000 requests per page/endpoint using curl with controlled concurrency
REPORT="/tmp/stress-test-complete-report.txt"
BASE="${BASE_URL:-http://localhost:3000}"

echo "═══════════════════════════════════════════════════════════════" > "$REPORT"
echo "  ALLFANTASY LEGACY STRESS TEST - COMPLETE REPORT" >> "$REPORT"
echo "  User: theciege24 | $(date)" >> "$REPORT"
echo "═══════════════════════════════════════════════════════════════" >> "$REPORT"
echo "" >> "$REPORT"
echo "PHASE 1: 11,002 records seeded (COMPLETED)" >> "$REPORT"
echo "" >> "$REPORT"
echo "═══════════ PHASE 2: PAGE LOAD TEST (1,000x each) ════════════" >> "$REPORT"
echo "" >> "$REPORT"

test_page() {
  local path="$1"
  local url="${BASE}${path}"
  local ok=0 fail=0 total_ms=0

  for i in $(seq 1 1000); do
    code=$(curl -s -o /dev/null -w "%{http_code},%{time_total}" --max-time 10 "$url")
    http_code=$(echo "$code" | cut -d, -f1)
    time_sec=$(echo "$code" | cut -d, -f2)
    time_ms=$(echo "$time_sec * 1000" | bc | cut -d. -f1)

    if [ "$http_code" -lt 500 ] 2>/dev/null; then
      ok=$((ok + 1))
      total_ms=$((total_ms + time_ms))
    else
      fail=$((fail + 1))
    fi
  done

  local avg=0
  if [ $ok -gt 0 ]; then avg=$((total_ms / ok)); fi
  local status="PASS"
  if [ $fail -gt 0 ]; then status="FAIL"; fi

  echo "[$status] ${path}  ${ok}/1000 ok  ${fail} failed  avg=${avg}ms"
  echo "[$status] ${path}  ${ok}/1000 ok  ${fail} failed  avg=${avg}ms" >> "$REPORT"
}

PAGES=("/dashboard" "/trade-evaluator" "/trade-finder" "/trade-history" "/waiver-ai" "/rankings" "/dynasty-trade-analyzer" "/mock-draft-simulator" "/ai-lab" "/leagues" "/legacy" "/af-legacy" "/login" "/brackets")

for page in "${PAGES[@]}"; do
  test_page "$page"
done

echo "" >> "$REPORT"
echo "═══════════ PHASE 3: API ENDPOINT TEST ════════════" >> "$REPORT"
echo "" >> "$REPORT"

test_api() {
  local name="$1"
  local method="$2"
  local path="$3"
  local data="$4"
  local count="$5"
  local url="${BASE}${path}"
  local ok=0 fail=0 total_ms=0

  for i in $(seq 1 $count); do
    if [ "$method" = "GET" ]; then
      code=$(curl -s -o /dev/null -w "%{http_code},%{time_total}" --max-time 15 "$url")
    else
      code=$(curl -s -o /dev/null -w "%{http_code},%{time_total}" --max-time 15 -X POST -H "Content-Type: application/json" -d "$data" "$url")
    fi
    http_code=$(echo "$code" | cut -d, -f1)
    time_sec=$(echo "$code" | cut -d, -f2)
    time_ms=$(echo "$time_sec * 1000" | bc | cut -d. -f1)

    if [ "$http_code" -lt 500 ] 2>/dev/null; then
      ok=$((ok + 1))
      total_ms=$((total_ms + time_ms))
    else
      fail=$((fail + 1))
    fi
  done

  local avg=0
  if [ $ok -gt 0 ]; then avg=$((total_ms / ok)); fi
  local status="PASS"
  if [ $fail -gt 0 ]; then status="WARN"; fi

  echo "[$status] ${name}  ${ok}/${count} ok  avg=${avg}ms"
  echo "[$status] ${name}  ${ok}/${count} ok  ${fail} failed  avg=${avg}ms" >> "$REPORT"
}

# Non-AI endpoints (1000x)
test_api "GET /api/league/list" GET "/api/league/list" "" 1000
test_api "GET /api/players/search" GET "/api/players/search?q=mahomes" "" 1000
test_api "GET /api/rankings" GET "/api/rankings" "" 1000
test_api "GET /api/rankings/adaptive" GET "/api/rankings/adaptive" "" 1000
test_api "GET /api/player-value" GET "/api/player-value?player=Patrick+Mahomes" "" 1000
test_api "GET /api/sports/trending" GET "/api/sports/trending" "" 1000
test_api "GET /api/sports/news" GET "/api/sports/news" "" 1000
test_api "GET /api/sports/injuries" GET "/api/sports/injuries" "" 1000
test_api "GET /api/sports/live-scores" GET "/api/sports/live-scores" "" 1000
test_api "GET /api/bracket/tournaments" GET "/api/bracket/tournaments" "" 1000
test_api "GET /api/bracket/public-pools" GET "/api/bracket/public-pools" "" 1000
test_api "GET /api/bracket/global-rankings" GET "/api/bracket/global-rankings" "" 1000
test_api "GET /api/bracket/feed" GET "/api/bracket/feed" "" 1000
test_api "GET /api/legacy/players" GET "/api/legacy/players" "" 1000
test_api "GET /api/legacy/devy-board" GET "/api/legacy/devy-board" "" 1000
test_api "POST /api/analytics/track" POST "/api/analytics/track" '{"event":"stress_test","path":"/test"}' 1000
test_api "POST /api/legacy/player-profile" POST "/api/legacy/player-profile" '{"playerName":"Patrick Mahomes"}' 1000
test_api "POST /api/legacy/player-stock" POST "/api/legacy/player-stock" '{"playerName":"Patrick Mahomes"}' 1000

# AI endpoints (10x)
test_api "[AI] POST /api/trade-evaluator" POST "/api/trade-evaluator" '{"give":["Patrick Mahomes"],"get":["Josh Allen"],"leagueId":"509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8","leagueSize":16,"isDynasty":true,"scoring":"ppr"}' 10
test_api "[AI] POST /api/waiver-ai" POST "/api/waiver-ai" '{"playerName":"Tank Dell","leagueId":"509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8","week":5}' 10
test_api "[AI] POST /api/ai/chat" POST "/api/ai/chat" '{"message":"Trade value of Mahomes?","sleeperUsername":"theciege24"}' 10
test_api "[AI] POST /api/dynasty-trade" POST "/api/dynasty-trade-analyzer" '{"give":["Breece Hall"],"get":["Bijan Robinson"],"leagueId":"f1b731f3-db1e-4214-bc39-bc07cda13efb"}' 10
test_api "[AI] POST /api/trade-finder" POST "/api/trade-finder" '{"leagueId":"509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8","sleeperUsername":"theciege24"}' 10
test_api "[AI] POST /api/mgr-psychology" POST "/api/rankings/manager-psychology" '{"leagueId":"509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8","sleeperUsername":"theciege24"}' 10
test_api "[AI] POST /api/roster/analyze" POST "/api/roster/analyze" '{"leagueId":"509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8"}' 10
test_api "[AI] POST /api/instant/trade" POST "/api/instant/trade" '{"give":["CeeDee Lamb"],"get":["Jamarr Chase","2026 2nd"],"isDynasty":true,"scoring":"ppr","leagueSize":12}' 10
test_api "[AI] POST /api/redraft-trade" POST "/api/redraft-trade" '{"give":["Tyreek Hill"],"get":["Amon-Ra St. Brown"],"leagueSize":12,"scoring":"ppr"}' 10

echo "" >> "$REPORT"
echo "═══════════════════════════════════════════════════════════════" >> "$REPORT"
echo "  TEST COMPLETE - $(date)" >> "$REPORT"
echo "═══════════════════════════════════════════════════════════════" >> "$REPORT"

echo ""
echo "Full report saved to: $REPORT"
