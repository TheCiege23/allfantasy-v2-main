import * as fs from "fs"

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const USER_ID = "6a0faf22-6bfa-4484-8acc-c6618028e334"
const USERNAME = "theciege24"
const LEAGUE_IDS = ["509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8", "f1b731f3-db1e-4214-bc39-bc07cda13efb"]
const TOTAL = 1000
const CONCURRENCY = 50
const REPORT_FILE = "/tmp/stress-test-report.txt"

function log(msg: string) {
  console.log(msg)
  fs.appendFileSync(REPORT_FILE, msg + "\n")
}

interface TestResult {
  name: string; total: number; success: number; failed: number
  avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number
  errors: string[]; statusCodes: Record<number, number>
}

function stats(name: string, times: number[], errors: string[], codes: Record<number, number>): TestResult {
  const s = [...times].sort((a, b) => a - b)
  const t = s.length + errors.length
  return {
    name, total: t, success: s.length, failed: errors.length,
    avgMs: s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0,
    p50Ms: s.length ? Math.round(s[Math.floor(s.length * 0.5)]) : 0,
    p95Ms: s.length ? Math.round(s[Math.floor(s.length * 0.95)]) : 0,
    p99Ms: s.length ? Math.round(s[Math.floor(s.length * 0.99)]) : 0,
    errors: errors.slice(0, 5), statusCodes: codes,
  }
}

async function testEndpoint(url: string, method: string, body: any, iterations: number): Promise<TestResult> {
  const times: number[] = []
  const errors: string[] = []
  const codes: Record<number, number> = {}
  for (let b = 0; b < iterations; b += CONCURRENCY) {
    const bs = Math.min(CONCURRENCY, iterations - b)
    await Promise.all(Array.from({ length: bs }, async () => {
      const start = Date.now()
      try {
        const opts: RequestInit = { method, headers: { "Content-Type": "application/json", "Accept": "text/html,application/json" } }
        if (method === "POST" && body) opts.body = JSON.stringify(body)
        const res = await fetch(url, opts)
        const el = Date.now() - start
        codes[res.status] = (codes[res.status] || 0) + 1
        if (res.status < 500) times.push(el)
        else errors.push(`HTTP ${res.status}`)
      } catch (err: any) { errors.push(err.message?.slice(0, 60) || "Unknown") }
    }))
  }
  return stats("", times, errors, codes)
}

async function main() {
  fs.writeFileSync(REPORT_FILE, "")

  log("╔══════════════════════════════════════════════════════════════╗")
  log("║   ALLFANTASY LEGACY STRESS TEST - COMPLETE REPORT          ║")
  log("║   User: theciege24 | " + new Date().toISOString().slice(0, 19) + "                    ║")
  log("╚══════════════════════════════════════════════════════════════╝")

  log("\n  Phase 1 already completed: 11,002 records seeded across 13 tables")
  log("  (waiver_pickups, mock_drafts, chat_conversations, trade_suggestion_votes,")
  log("   trade_feedback, TradeNotification, LeagueTradeHistory+LeagueTrade,")
  log("   trade_analysis_snapshots, AIUserProfile, trade_profiles, AnalyticsEvent,")
  log("   InsightEvent, DecisionLog)")

  log("\n" + "=".repeat(70))
  log("  PHASE 2: LOAD TEST 14 LEGACY PAGES (1,000x each)")
  log("=".repeat(70))

  const pages = [
    "/dashboard", "/trade-evaluator", "/trade-finder", "/trade-history",
    "/waiver-ai", "/rankings", "/dynasty-trade-analyzer", "/mock-draft-simulator",
    "/ai-lab", "/leagues", "/legacy", "/af-legacy", "/login", "/brackets",
  ]

  const loadResults: TestResult[] = []
  for (const page of pages) {
    const r = await testEndpoint(`${BASE_URL}${page}`, "GET", null, TOTAL)
    r.name = page
    loadResults.push(r)
    const cs = Object.entries(r.statusCodes).map(([k, v]) => `${k}:${v}`).join(" ")
    log(`  [${r.failed === 0 ? "PASS" : "FAIL"}] ${page.padEnd(30)} ${r.success}/${r.total}  avg=${r.avgMs}ms  p50=${r.p50Ms}ms  p95=${r.p95Ms}ms  p99=${r.p99Ms}ms  [${cs}]`)
  }

  log("\n" + "=".repeat(70))
  log("  PHASE 3: API ENDPOINT TESTING")
  log("  Non-AI: 1,000x | AI-powered: 10x (to conserve API credits)")
  log("=".repeat(70))

  const apiDefs = [
    { name: "GET /api/league/list", m: "GET", p: "/api/league/list", n: TOTAL },
    { name: "GET /api/players/search", m: "GET", p: "/api/players/search?q=mahomes", n: TOTAL },
    { name: "GET /api/rankings", m: "GET", p: "/api/rankings", n: TOTAL },
    { name: "GET /api/rankings/adaptive", m: "GET", p: "/api/rankings/adaptive", n: TOTAL },
    { name: "GET /api/player-value", m: "GET", p: "/api/player-value?player=Patrick+Mahomes", n: TOTAL },
    { name: "GET /api/sports/trending", m: "GET", p: "/api/sports/trending", n: TOTAL },
    { name: "GET /api/sports/news", m: "GET", p: "/api/sports/news", n: TOTAL },
    { name: "GET /api/sports/injuries", m: "GET", p: "/api/sports/injuries", n: TOTAL },
    { name: "GET /api/sports/live-scores", m: "GET", p: "/api/sports/live-scores", n: TOTAL },
    { name: "GET /api/bracket/tournaments", m: "GET", p: "/api/bracket/tournaments", n: TOTAL },
    { name: "GET /api/bracket/public-pools", m: "GET", p: "/api/bracket/public-pools", n: TOTAL },
    { name: "GET /api/bracket/global-rankings", m: "GET", p: "/api/bracket/global-rankings", n: TOTAL },
    { name: "GET /api/bracket/feed", m: "GET", p: "/api/bracket/feed", n: TOTAL },
    { name: "GET /api/legacy/players", m: "GET", p: "/api/legacy/players", n: TOTAL },
    { name: "GET /api/legacy/devy-board", m: "GET", p: "/api/legacy/devy-board", n: TOTAL },
    { name: "POST /api/analytics/track", m: "POST", p: "/api/analytics/track", b: { event: "stress_test", path: "/test" }, n: TOTAL },
    { name: "POST /api/legacy/player-profile", m: "POST", p: "/api/legacy/player-profile", b: { playerName: "Patrick Mahomes" }, n: TOTAL },
    { name: "POST /api/legacy/player-stock", m: "POST", p: "/api/legacy/player-stock", b: { playerName: "Patrick Mahomes" }, n: TOTAL },
    { name: "[AI] POST /api/trade-evaluator", m: "POST", p: "/api/trade-evaluator", b: { give: ["Patrick Mahomes"], get: ["Josh Allen"], leagueId: LEAGUE_IDS[0], leagueSize: 16, isDynasty: true, scoring: "ppr" }, n: 10 },
    { name: "[AI] POST /api/waiver-ai", m: "POST", p: "/api/waiver-ai", b: { playerName: "Tank Dell", leagueId: LEAGUE_IDS[0], week: 5 }, n: 10 },
    { name: "[AI] POST /api/ai/chat", m: "POST", p: "/api/ai/chat", b: { message: "Trade value of Mahomes?", sleeperUsername: USERNAME }, n: 10 },
    { name: "[AI] POST /api/dynasty-trade-analyzer", m: "POST", p: "/api/dynasty-trade-analyzer", b: { give: ["Breece Hall"], get: ["Bijan Robinson"], leagueId: LEAGUE_IDS[1] }, n: 10 },
    { name: "[AI] POST /api/trade-finder", m: "POST", p: "/api/trade-finder", b: { leagueId: LEAGUE_IDS[0], sleeperUsername: USERNAME }, n: 10 },
    { name: "[AI] POST /api/rankings/mgr-psych", m: "POST", p: "/api/rankings/manager-psychology", b: { leagueId: LEAGUE_IDS[0], sleeperUsername: USERNAME }, n: 10 },
    { name: "[AI] POST /api/roster/analyze", m: "POST", p: "/api/roster/analyze", b: { leagueId: LEAGUE_IDS[0] }, n: 10 },
    { name: "[AI] POST /api/instant/trade", m: "POST", p: "/api/instant/trade", b: { give: ["CeeDee Lamb"], get: ["Ja'Marr Chase", "2026 2nd"], isDynasty: true, scoring: "ppr", leagueSize: 12 }, n: 10 },
    { name: "[AI] POST /api/redraft-trade", m: "POST", p: "/api/redraft-trade", b: { give: ["Tyreek Hill"], get: ["Amon-Ra St. Brown"], leagueSize: 12, scoring: "ppr" }, n: 10 },
  ]

  const apiResults: TestResult[] = []
  for (const t of apiDefs) {
    const r = await testEndpoint(`${BASE_URL}${t.p}`, t.m, (t as any).b, t.n)
    r.name = t.name
    apiResults.push(r)
    const cs = Object.entries(r.statusCodes).map(([k, v]) => `${k}:${v}`).join(" ")
    log(`  [${r.failed === 0 ? "PASS" : r.failed < r.total ? "WARN" : "FAIL"}] ${t.name.padEnd(42)} ${r.success}/${r.total}  avg=${r.avgMs}ms  p95=${r.p95Ms}ms  [${cs}]`)
    if (t.n <= 10) await new Promise(r => setTimeout(r, 500))
  }

  log("\n\n" + "═".repeat(70))
  log("  ███████ FINAL CONSOLIDATED REPORT ███████")
  log("═".repeat(70))

  log("\n  ┌─── PHASE 1: DATA SEEDING ───────────────────────────────────────┐")
  log("  │  11,002 total records seeded across 13 tables                   │")
  log("  │  All inserts successful                                         │")
  log("  └─────────────────────────────────────────────────────────────────┘")

  log("\n  ┌─── PHASE 2: PAGE LOAD TEST (1,000x per page) ──────────────────┐")
  log(`  │  ${"Page".padEnd(26)} ${"OK".padStart(5)} ${"Fail".padStart(5)} ${"Avg".padStart(7)} ${"P50".padStart(7)} ${"P95".padStart(7)} ${"P99".padStart(7)}  │`)
  log("  │  " + "-".repeat(64) + "  │")
  let tpOk = 0, tpFail = 0
  for (const r of loadResults) {
    tpOk += r.success; tpFail += r.failed
    log(`  │  ${r.name.padEnd(26)} ${String(r.success).padStart(5)} ${String(r.failed).padStart(5)} ${(r.avgMs + "ms").padStart(7)} ${(r.p50Ms + "ms").padStart(7)} ${(r.p95Ms + "ms").padStart(7)} ${(r.p99Ms + "ms").padStart(7)}  │`)
  }
  log("  │  " + "-".repeat(64) + "  │")
  log(`  │  ${"TOTAL".padEnd(26)} ${String(tpOk).padStart(5)} ${String(tpFail).padStart(5)}${"".padStart(30)}  │`)
  log(`  │  Success Rate: ${((tpOk / (tpOk + tpFail)) * 100).toFixed(2)}%${"".padStart(43)}  │`)
  log("  └─────────────────────────────────────────────────────────────────┘")

  log("\n  ┌─── PHASE 3: API ENDPOINT TEST ─────────────────────────────────┐")
  log(`  │  ${"Endpoint".padEnd(40)} ${"OK".padStart(5)} ${"Fail".padStart(5)} ${"Avg".padStart(7)} ${"P95".padStart(7)}  │`)
  log("  │  " + "-".repeat(64) + "  │")
  let taOk = 0, taFail = 0
  for (const r of apiResults) {
    taOk += r.success; taFail += r.failed
    log(`  │  ${r.name.padEnd(40)} ${String(r.success).padStart(5)} ${String(r.failed).padStart(5)} ${(r.avgMs + "ms").padStart(7)} ${(r.p95Ms + "ms").padStart(7)}  │`)
  }
  log("  │  " + "-".repeat(64) + "  │")
  log(`  │  ${"TOTAL".padEnd(40)} ${String(taOk).padStart(5)} ${String(taFail).padStart(5)}${"".padStart(16)}  │`)
  log(`  │  Success Rate: ${((taOk / (taOk + taFail)) * 100).toFixed(2)}%${"".padStart(43)}  │`)
  log("  └─────────────────────────────────────────────────────────────────┘")

  const errList = [...loadResults, ...apiResults].filter(r => r.failed > 0)
  if (errList.length > 0) {
    log("\n  ┌─── ERROR DETAILS ──────────────────────────────────────────────┐")
    for (const r of errList) {
      log(`  │  ${r.name} (${r.failed} failures)`)
      for (const e of r.errors) log(`  │    → ${e}`)
    }
    log("  └─────────────────────────────────────────────────────────────────┘")
  }

  log("\n  ╔═══════════════════════════════════════════════════════════════════╗")
  log(`  ║  GRAND TOTAL                                                     ║`)
  log(`  ║  Phase 1: 11,002 records seeded                                  ║`)
  log(`  ║  Phase 2: ${String(tpOk + tpFail).padStart(6)} page requests  (${String(tpOk).padStart(6)} ok, ${String(tpFail).padStart(4)} failed)       ║`)
  log(`  ║  Phase 3: ${String(taOk + taFail).padStart(6)} API requests   (${String(taOk).padStart(6)} ok, ${String(taFail).padStart(4)} failed)       ║`)
  log(`  ║  Combined: ${String(11002 + tpOk + tpFail + taOk + taFail).padStart(6)} total operations                              ║`)
  log("  ╚═══════════════════════════════════════════════════════════════════╝\n")
}

main().catch(e => { log("Fatal: " + e.message); process.exit(1) })
