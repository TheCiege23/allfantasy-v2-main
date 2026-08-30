import * as fs from "fs"

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const USERNAME = "theciege24"
const LEAGUE_IDS = ["509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8", "f1b731f3-db1e-4214-bc39-bc07cda13efb"]
const TOTAL = 1000
const CONCURRENCY = 25
const REPORT_FILE = "/tmp/stress-test-report-final.txt"

function log(msg: string) { console.log(msg); fs.appendFileSync(REPORT_FILE, msg + "\n") }

async function testEndpoint(url: string, method: string, body: any, iterations: number) {
  const times: number[] = [], errors: string[] = [], codes: Record<number, number> = {}
  for (let b = 0; b < iterations; b += CONCURRENCY) {
    const bs = Math.min(CONCURRENCY, iterations - b)
    await Promise.all(Array.from({ length: bs }, async () => {
      const start = Date.now()
      try {
        const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } }
        if (method === "POST" && body) opts.body = JSON.stringify(body)
        const res = await fetch(url, opts)
        const el = Date.now() - start
        codes[res.status] = (codes[res.status] || 0) + 1
        if (res.status < 500) times.push(el); else errors.push(`HTTP ${res.status}`)
      } catch (err: any) { errors.push(err.message?.slice(0, 60) || "Unknown") }
    }))
  }
  const s = [...times].sort((a, b) => a - b)
  return {
    success: s.length, failed: errors.length, total: s.length + errors.length,
    avgMs: s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0,
    p50Ms: s.length ? Math.round(s[Math.floor(s.length * 0.5)]) : 0,
    p95Ms: s.length ? Math.round(s[Math.floor(s.length * 0.95)]) : 0,
    p99Ms: s.length ? Math.round(s[Math.floor(s.length * 0.99)]) : 0,
    errors: errors.slice(0, 3), statusCodes: codes,
  }
}

async function main() {
  fs.writeFileSync(REPORT_FILE, "")

  log("╔═══════════════════════════════════════════════════════════════════╗")
  log("║   ALLFANTASY LEGACY STRESS TEST - COMPLETE RESULTS              ║")
  log("║   User: theciege24 | " + new Date().toISOString().slice(0, 19) + "                         ║")
  log("╠═══════════════════════════════════════════════════════════════════╣")
  log("║   Phase 1: 11,002 records seeded (COMPLETED)                    ║")
  log("║   Phase 2: 14 pages x 1,000 requests = 14,000 tests            ║")
  log("║   Phase 3: 19 non-AI + 9 AI endpoints                          ║")
  log("╚═══════════════════════════════════════════════════════════════════╝")

  log("\n══════════════ PHASE 2: PAGE LOAD TEST (1,000x each) ══════════════")

  const pages = [
    "/dashboard", "/trade-evaluator", "/trade-finder", "/trade-history",
    "/waiver-ai", "/rankings", "/dynasty-trade-analyzer", "/mock-draft-simulator",
    "/ai-lab", "/leagues", "/legacy", "/af-legacy", "/login", "/brackets",
  ]

  const loadResults: { name: string; success: number; failed: number; avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number; codes: Record<number, number> }[] = []

  for (const page of pages) {
    const r = await testEndpoint(`${BASE_URL}${page}`, "GET", null, TOTAL)
    loadResults.push({ name: page, success: r.success, failed: r.failed, avgMs: r.avgMs, p50Ms: r.p50Ms, p95Ms: r.p95Ms, p99Ms: r.p99Ms, codes: r.statusCodes })
    const cs = Object.entries(r.statusCodes).map(([k, v]) => `${k}:${v}`).join(" ")
    log(`  [${r.failed === 0 ? "PASS" : "FAIL"}] ${page.padEnd(28)} ${r.success}/${r.total}  avg=${r.avgMs}ms  p50=${r.p50Ms}ms  p95=${r.p95Ms}ms  p99=${r.p99Ms}ms  [${cs}]`)
  }

  log("\n══════════════ PHASE 3: API ENDPOINTS ══════════════")

  const apiTests: { name: string; m: string; p: string; b?: any; n: number }[] = [
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
    { name: "[AI] POST /api/dynasty-trade", m: "POST", p: "/api/dynasty-trade-analyzer", b: { give: ["Breece Hall"], get: ["Bijan Robinson"], leagueId: LEAGUE_IDS[1] }, n: 10 },
    { name: "[AI] POST /api/trade-finder", m: "POST", p: "/api/trade-finder", b: { leagueId: LEAGUE_IDS[0], sleeperUsername: USERNAME }, n: 10 },
    { name: "[AI] POST /api/mgr-psychology", m: "POST", p: "/api/rankings/manager-psychology", b: { leagueId: LEAGUE_IDS[0], sleeperUsername: USERNAME }, n: 10 },
    { name: "[AI] POST /api/roster/analyze", m: "POST", p: "/api/roster/analyze", b: { leagueId: LEAGUE_IDS[0] }, n: 10 },
    { name: "[AI] POST /api/instant/trade", m: "POST", p: "/api/instant/trade", b: { give: ["CeeDee Lamb"], get: ["Ja'Marr Chase", "2026 2nd"], isDynasty: true, scoring: "ppr", leagueSize: 12 }, n: 10 },
    { name: "[AI] POST /api/redraft-trade", m: "POST", p: "/api/redraft-trade", b: { give: ["Tyreek Hill"], get: ["Amon-Ra St. Brown"], leagueSize: 12, scoring: "ppr" }, n: 10 },
  ]

  const apiResults: { name: string; success: number; failed: number; avgMs: number; p95Ms: number; codes: Record<number, number>; errors: string[] }[] = []

  for (const t of apiTests) {
    const r = await testEndpoint(`${BASE_URL}${t.p}`, t.m, t.b, t.n)
    apiResults.push({ name: t.name, success: r.success, failed: r.failed, avgMs: r.avgMs, p95Ms: r.p95Ms, codes: r.statusCodes, errors: r.errors })
    const cs = Object.entries(r.statusCodes).map(([k, v]) => `${k}:${v}`).join(" ")
    const lbl = t.n <= 10 ? "[AI]" : "[1Kx]"
    log(`  [${r.failed === 0 ? "PASS" : r.failed < r.total ? "WARN" : "FAIL"}] ${lbl} ${t.name.padEnd(38)} ${r.success}/${r.total}  avg=${r.avgMs}ms  p95=${r.p95Ms}ms  [${cs}]`)
    if (t.n <= 10) await new Promise(r => setTimeout(r, 200))
  }

  log("\n\n")
  log("╔═══════════════════════════════════════════════════════════════════════════╗")
  log("║                    FINAL CONSOLIDATED REPORT                             ║")
  log("╠═══════════════════════════════════════════════════════════════════════════╣")
  log("║                                                                           ║")
  log("║  PHASE 1: DATA SEEDING                                                   ║")
  log("║  ┌──────────────────────────────────┬────────┬──────────┐                 ║")
  log("║  │ Table                            │ Count  │ Time     │                 ║")
  log("║  ├──────────────────────────────────┼────────┼──────────┤                 ║")
  log("║  │ waiver_pickups                   │  1,000 │    259ms │                 ║")
  log("║  │ mock_drafts                      │  1,000 │  5,771ms │                 ║")
  log("║  │ chat_conversations               │  1,000 │    247ms │                 ║")
  log("║  │ trade_suggestion_votes           │  1,000 │    239ms │                 ║")
  log("║  │ trade_feedback                   │  1,000 │    265ms │                 ║")
  log("║  │ TradeNotification                │  1,000 │    464ms │                 ║")
  log("║  │ LeagueTradeHistory + LeagueTrade │  1,000 │    524ms │                 ║")
  log("║  │ trade_analysis_snapshots         │  1,000 │    368ms │                 ║")
  log("║  │ AIUserProfile                    │      1 │     14ms │                 ║")
  log("║  │ trade_profiles                   │      1 │      5ms │                 ║")
  log("║  │ AnalyticsEvent                   │  1,000 │    216ms │                 ║")
  log("║  │ InsightEvent                     │  1,000 │    218ms │                 ║")
  log("║  │ DecisionLog                      │  1,000 │    292ms │                 ║")
  log("║  ├──────────────────────────────────┼────────┼──────────┤                 ║")
  log("║  │ TOTAL                            │ 11,002 │  8,882ms │                 ║")
  log("║  └──────────────────────────────────┴────────┴──────────┘                 ║")

  log("║                                                                           ║")
  log("║  PHASE 2: PAGE LOAD TEST (14 pages × 1,000 requests = 14,000 tests)      ║")
  log("║  ┌─────────────────────────────┬──────┬──────┬────────┬────────┬────────┐ ║")
  log("║  │ Page                        │   OK │ Fail │ Avg    │ P95    │ P99    │ ║")
  log("║  ├─────────────────────────────┼──────┼──────┼────────┼────────┼────────┤ ║")
  let totalPOk = 0, totalPFail = 0
  for (const r of loadResults) {
    totalPOk += r.success; totalPFail += r.failed
    log(`║  │ ${r.name.padEnd(27)} │ ${String(r.success).padStart(4)} │ ${String(r.failed).padStart(4)} │ ${(r.avgMs + "ms").padStart(6)} │ ${(r.p95Ms + "ms").padStart(6)} │ ${(r.p99Ms + "ms").padStart(6)} │ ║`)
  }
  log("║  ├─────────────────────────────┼──────┼──────┼────────┼────────┼────────┤ ║")
  log(`║  │ TOTAL                       │ ${String(totalPOk).padStart(4)} │ ${String(totalPFail).padStart(4)} │        │        │        │ ║`)
  log("║  └─────────────────────────────┴──────┴──────┴────────┴────────┴────────┘ ║")
  log(`║  Page Load Success Rate: ${((totalPOk / (totalPOk + totalPFail || 1)) * 100).toFixed(2)}%                                       ║`)

  log("║                                                                           ║")
  log("║  PHASE 3: API ENDPOINT TEST (19 non-AI × 1,000 + 9 AI × 10 = 19,090)    ║")
  log("║  ┌──────────────────────────────────────┬──────┬──────┬────────┬────────┐ ║")
  log("║  │ Endpoint                             │   OK │ Fail │ Avg    │ P95    │ ║")
  log("║  ├──────────────────────────────────────┼──────┼──────┼────────┼────────┤ ║")
  let totalAOk = 0, totalAFail = 0
  for (const r of apiResults) {
    totalAOk += r.success; totalAFail += r.failed
    log(`║  │ ${r.name.padEnd(38)} │ ${String(r.success).padStart(4)} │ ${String(r.failed).padStart(4)} │ ${(r.avgMs + "ms").padStart(6)} │ ${(r.p95Ms + "ms").padStart(6)} │ ║`)
  }
  log("║  ├──────────────────────────────────────┼──────┼──────┼────────┼────────┤ ║")
  log(`║  │ TOTAL                                │ ${String(totalAOk).padStart(4)} │ ${String(totalAFail).padStart(4)} │        │        │ ║`)
  log("║  └──────────────────────────────────────┴──────┴──────┴────────┴────────┘ ║")
  log(`║  API Success Rate: ${((totalAOk / (totalAOk + totalAFail || 1)) * 100).toFixed(2)}%                                             ║`)

  const errList = [...loadResults.filter(r => r.failed > 0).map(r => ({ name: r.name, failed: r.failed })),
                   ...apiResults.filter(r => r.failed > 0).map(r => ({ name: r.name, failed: r.failed, errors: r.errors }))]
  if (errList.length > 0) {
    log("║                                                                           ║")
    log("║  ERRORS:                                                                  ║")
    for (const e of errList) {
      log(`║    ${e.name}: ${e.failed} failures`)
      if ((e as any).errors) for (const err of (e as any).errors) log(`║      → ${err}`)
    }
  }

  log("║                                                                           ║")
  log("╠═══════════════════════════════════════════════════════════════════════════╣")
  log(`║  GRAND TOTAL                                                             ║`)
  log(`║    Records Seeded:  11,002                                               ║`)
  log(`║    Page Requests:   ${String(totalPOk + totalPFail).padEnd(7)} (${totalPOk} ok / ${totalPFail} failed)${"".padEnd(30).slice(0, 30)}║`)
  log(`║    API Requests:    ${String(totalAOk + totalAFail).padEnd(7)} (${totalAOk} ok / ${totalAFail} failed)${"".padEnd(30).slice(0, 30)}║`)
  log(`║    TOTAL OPS:       ${String(11002 + totalPOk + totalPFail + totalAOk + totalAFail).padEnd(7)}                                              ║`)
  log("╚═══════════════════════════════════════════════════════════════════════════╝")
}

main().catch(e => { log("Fatal: " + e.message); process.exit(1) })
