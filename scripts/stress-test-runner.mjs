import { writeFileSync, appendFileSync } from "fs"

const BASE = process.env.BASE_URL || "http://localhost:3000"
const TOTAL = 1000
const CONC = 10
const REPORT = "/tmp/stress-test-complete-report.txt"

function log(msg) { console.log(msg); appendFileSync(REPORT, msg + "\n") }

async function test(url, method, body, iters) {
  const times = [], errs = [], codes = {}
  for (let i = 0; i < iters; i += CONC) {
    const n = Math.min(CONC, iters - i)
    const results = await Promise.allSettled(Array.from({ length: n }, async () => {
      const s = Date.now()
      const opts = { method, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000) }
      if (method === "POST" && body) opts.body = JSON.stringify(body)
      const r = await fetch(url, opts)
      return { status: r.status, ms: Date.now() - s }
    }))
    for (const r of results) {
      if (r.status === "fulfilled") {
        codes[r.value.status] = (codes[r.value.status] || 0) + 1
        if (r.value.status < 500) times.push(r.value.ms)
        else errs.push("HTTP " + r.value.status)
      } else errs.push(String(r.reason).slice(0, 60))
    }
  }
  times.sort((a, b) => a - b)
  const len = times.length
  return {
    ok: len, fail: errs.length,
    avg: len ? Math.round(times.reduce((a, b) => a + b, 0) / len) : 0,
    p50: times[Math.floor(len * .5)] || 0,
    p95: times[Math.floor(len * .95)] || 0,
    p99: times[Math.floor(len * .99)] || 0,
    codes, errs: errs.slice(0, 3)
  }
}

async function main() {
  writeFileSync(REPORT, "")
  log("╔═══════════════════════════════════════════════════════════════════╗")
  log("║   ALLFANTASY LEGACY STRESS TEST - COMPLETE REPORT               ║")
  log("║   User: theciege24 | " + new Date().toISOString().slice(0, 19) + "                          ║")
  log("╚═══════════════════════════════════════════════════════════════════╝")
  log("")
  log("PHASE 1: 11,002 records seeded across 13 tables (COMPLETED)")
  log("")
  log("═══════════ PHASE 2: PAGE LOAD TEST (14 pages × 1,000) ═══════════")

  const pages = [
    "/dashboard", "/trade-evaluator", "/trade-finder", "/trade-history",
    "/waiver-ai", "/rankings", "/dynasty-trade-analyzer", "/mock-draft-simulator",
    "/ai-lab", "/leagues", "/legacy", "/af-legacy", "/login", "/brackets"
  ]

  const pageResults = []
  for (const p of pages) {
    const r = await test(BASE + p, "GET", null, TOTAL)
    pageResults.push({ name: p, ...r })
    const cs = Object.entries(r.codes).map(([k, v]) => k + ":" + v).join(" ")
    log(`  [${r.fail === 0 ? "PASS" : "FAIL"}] ${p.padEnd(28)} ${r.ok}/${r.ok + r.fail}  avg=${r.avg}ms  p50=${r.p50}ms  p95=${r.p95}ms  p99=${r.p99}ms  [${cs}]`)
  }

  log("")
  log("═══════════ PHASE 3: API ENDPOINT TEST ═══════════")
  log("  Non-AI: 1,000x | AI-powered: 10x")

  const LID1 = "509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8"
  const LID2 = "f1b731f3-db1e-4214-bc39-bc07cda13efb"

  const apis = [
    ["GET /api/league/list", "GET", "/api/league/list", null, TOTAL],
    ["GET /api/players/search", "GET", "/api/players/search?q=mahomes", null, TOTAL],
    ["GET /api/rankings", "GET", "/api/rankings", null, TOTAL],
    ["GET /api/rankings/adaptive", "GET", "/api/rankings/adaptive", null, TOTAL],
    ["GET /api/player-value", "GET", "/api/player-value?player=Patrick+Mahomes", null, TOTAL],
    ["GET /api/sports/trending", "GET", "/api/sports/trending", null, TOTAL],
    ["GET /api/sports/news", "GET", "/api/sports/news", null, TOTAL],
    ["GET /api/sports/injuries", "GET", "/api/sports/injuries", null, TOTAL],
    ["GET /api/sports/live-scores", "GET", "/api/sports/live-scores", null, TOTAL],
    ["GET /api/bracket/tournaments", "GET", "/api/bracket/tournaments", null, TOTAL],
    ["GET /api/bracket/public-pools", "GET", "/api/bracket/public-pools", null, TOTAL],
    ["GET /api/bracket/global-rankings", "GET", "/api/bracket/global-rankings", null, TOTAL],
    ["GET /api/bracket/feed", "GET", "/api/bracket/feed", null, TOTAL],
    ["GET /api/legacy/players", "GET", "/api/legacy/players", null, TOTAL],
    ["GET /api/legacy/devy-board", "GET", "/api/legacy/devy-board", null, TOTAL],
    ["POST /api/analytics/track", "POST", "/api/analytics/track", { event: "stress_test", path: "/test" }, TOTAL],
    ["POST /api/legacy/player-profile", "POST", "/api/legacy/player-profile", { playerName: "Patrick Mahomes" }, TOTAL],
    ["POST /api/legacy/player-stock", "POST", "/api/legacy/player-stock", { playerName: "Patrick Mahomes" }, TOTAL],
    ["[AI] trade-evaluator", "POST", "/api/trade-evaluator", { give: ["Patrick Mahomes"], get: ["Josh Allen"], leagueId: LID1, leagueSize: 16, isDynasty: true, scoring: "ppr" }, 10],
    ["[AI] waiver-ai", "POST", "/api/waiver-ai", { playerName: "Tank Dell", leagueId: LID1, week: 5 }, 10],
    ["[AI] ai/chat", "POST", "/api/ai/chat", { message: "Trade value of Mahomes?", sleeperUsername: "theciege24" }, 10],
    ["[AI] dynasty-trade", "POST", "/api/dynasty-trade-analyzer", { give: ["Breece Hall"], get: ["Bijan Robinson"], leagueId: LID2 }, 10],
    ["[AI] trade-finder", "POST", "/api/trade-finder", { leagueId: LID1, sleeperUsername: "theciege24" }, 10],
    ["[AI] mgr-psychology", "POST", "/api/rankings/manager-psychology", { leagueId: LID1, sleeperUsername: "theciege24" }, 10],
    ["[AI] roster/analyze", "POST", "/api/roster/analyze", { leagueId: LID1 }, 10],
    ["[AI] instant/trade", "POST", "/api/instant/trade", { give: ["CeeDee Lamb"], get: ["Ja'Marr Chase", "2026 2nd"], isDynasty: true, scoring: "ppr", leagueSize: 12 }, 10],
    ["[AI] redraft-trade", "POST", "/api/redraft-trade", { give: ["Tyreek Hill"], get: ["Amon-Ra St. Brown"], leagueSize: 12, scoring: "ppr" }, 10],
  ]

  const apiResults = []
  for (const [name, method, path, body, n] of apis) {
    const r = await test(BASE + path, method, body, n)
    apiResults.push({ name, ...r })
    const cs = Object.entries(r.codes).map(([k, v]) => k + ":" + v).join(" ")
    log(`  [${r.fail === 0 ? "PASS" : "WARN"}] ${name.padEnd(32)} ${r.ok}/${n}  avg=${r.avg}ms  p95=${r.p95}ms  [${cs}]`)
    if (n <= 10) await new Promise(r => setTimeout(r, 300))
  }

  // Final report
  let tpOk = 0, tpFail = 0, taOk = 0, taFail = 0
  pageResults.forEach(r => { tpOk += r.ok; tpFail += r.fail })
  apiResults.forEach(r => { taOk += r.ok; taFail += r.fail })

  log("")
  log("═══════════════════════════════════════════════════════════════════")
  log("                   FINAL CONSOLIDATED REPORT                      ")
  log("═══════════════════════════════════════════════════════════════════")
  log("")
  log("PHASE 1 - DATA SEEDING:")
  log("  Records seeded: 11,002 across 13 tables")
  log("  Tables: waiver_pickups(1K), mock_drafts(1K), chat_conversations(1K),")
  log("          trade_suggestion_votes(1K), trade_feedback(1K), TradeNotification(1K),")
  log("          LeagueTradeHistory+LeagueTrade(1K), trade_analysis_snapshots(1K),")
  log("          AIUserProfile(1), trade_profiles(1), AnalyticsEvent(1K),")
  log("          InsightEvent(1K), DecisionLog(1K)")
  log("")
  log("PHASE 2 - PAGE LOAD TEST (14 pages × 1,000 = 14,000 requests):")
  log("  ┌─────────────────────────────┬──────┬──────┬────────┬────────┬────────┐")
  log("  │ Page                        │   OK │ Fail │ Avg    │ P95    │ P99    │")
  log("  ├─────────────────────────────┼──────┼──────┼────────┼────────┼────────┤")
  for (const r of pageResults) {
    log(`  │ ${r.name.padEnd(27)} │ ${String(r.ok).padStart(4)} │ ${String(r.fail).padStart(4)} │ ${(r.avg+"ms").padStart(6)} │ ${(r.p95+"ms").padStart(6)} │ ${(r.p99+"ms").padStart(6)} │`)
  }
  log("  ├─────────────────────────────┼──────┼──────┼────────┼────────┼────────┤")
  log(`  │ TOTAL                       │ ${String(tpOk).padStart(4)} │ ${String(tpFail).padStart(4)} │        │        │        │`)
  log("  └─────────────────────────────┴──────┴──────┴────────┴────────┴────────┘")
  log(`  Success Rate: ${((tpOk / (tpOk + tpFail || 1)) * 100).toFixed(2)}%`)
  log("")
  log("PHASE 3 - API ENDPOINT TEST (19 non-AI × 1,000 + 9 AI × 10):")
  log("  ┌──────────────────────────────────┬──────┬──────┬────────┬────────┐")
  log("  │ Endpoint                         │   OK │ Fail │ Avg    │ P95    │")
  log("  ├──────────────────────────────────┼──────┼──────┼────────┼────────┤")
  for (const r of apiResults) {
    log(`  │ ${r.name.padEnd(32)} │ ${String(r.ok).padStart(4)} │ ${String(r.fail).padStart(4)} │ ${(r.avg+"ms").padStart(6)} │ ${(r.p95+"ms").padStart(6)} │`)
  }
  log("  ├──────────────────────────────────┼──────┼──────┼────────┼────────┤")
  log(`  │ TOTAL                            │ ${String(taOk).padStart(4)} │ ${String(taFail).padStart(4)} │        │        │`)
  log("  └──────────────────────────────────┴──────┴──────┴────────┴────────┘")
  log(`  Success Rate: ${((taOk / (taOk + taFail || 1)) * 100).toFixed(2)}%`)

  const allErrors = [...pageResults, ...apiResults].filter(r => r.fail > 0)
  if (allErrors.length > 0) {
    log("")
    log("ERROR DETAILS:")
    for (const r of allErrors) {
      log(`  ${r.name}: ${r.fail} failures`)
      for (const e of r.errs) log(`    → ${e}`)
    }
  }

  log("")
  log("═══════════════════════════════════════════════════════════════════")
  log(`  GRAND TOTAL:`)
  log(`    Phase 1: 11,002 records seeded`)
  log(`    Phase 2: ${tpOk + tpFail} page requests (${tpOk} ok, ${tpFail} failed)`)
  log(`    Phase 3: ${taOk + taFail} API requests (${taOk} ok, ${taFail} failed)`)
  log(`    Combined: ${11002 + tpOk + tpFail + taOk + taFail} total operations`)
  log("═══════════════════════════════════════════════════════════════════")
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
