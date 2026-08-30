const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const USER_ID = "6a0faf22-6bfa-4484-8acc-c6618028e334"
const USERNAME = "theciege24"
const LEAGUE_IDS = ["509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8", "f1b731f3-db1e-4214-bc39-bc07cda13efb"]
const TOTAL = 1000
const CONCURRENCY = 10

interface TestResult {
  name: string; total: number; success: number; failed: number
  avgMs: number; p50Ms: number; p95Ms: number; p99Ms: number
  errors: string[]; statusCodes: Record<number, number>
}

function computeStats(name: string, times: number[], errors: string[], codes: Record<number, number>): TestResult {
  const sorted = [...times].sort((a, b) => a - b)
  const total = sorted.length + errors.length
  return {
    name, total, success: sorted.length, failed: errors.length,
    avgMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
    p50Ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.5)]) : 0,
    p95Ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)]) : 0,
    p99Ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.99)]) : 0,
    errors: errors.slice(0, 5), statusCodes: codes,
  }
}

async function runBatch(url: string, method: string, body: any, iterations: number): Promise<TestResult> {
  const times: number[] = []
  const errors: string[] = []
  const codes: Record<number, number> = {}

  for (let batch = 0; batch < iterations; batch += CONCURRENCY) {
    const batchSize = Math.min(CONCURRENCY, iterations - batch)
    const promises = Array.from({ length: batchSize }, async () => {
      const start = Date.now()
      try {
        const options: RequestInit = { method, headers: { "Content-Type": "application/json", "Accept": "text/html,application/json" } }
        if (method === "POST" && body) options.body = JSON.stringify(body)
        const res = await fetch(url, options)
        const elapsed = Date.now() - start
        codes[res.status] = (codes[res.status] || 0) + 1
        if (res.status < 500) { times.push(elapsed) }
        else { errors.push(`HTTP ${res.status}`) }
      } catch (err: any) { errors.push(err.message?.slice(0, 80) || "Unknown") }
    })
    await Promise.all(promises)
  }
  return computeStats("", times, errors, codes)
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗")
  console.log("║   ALLFANTASY LEGACY STRESS TEST - PHASES 2 & 3            ║")
  console.log("║   User: theciege24 | 1,000 iterations                     ║")
  console.log("╚══════════════════════════════════════════════════════════════╝")

  console.log("\n" + "=".repeat(60))
  console.log("  PHASE 2: LOAD TEST 14 LEGACY PAGES (1,000x each)")
  console.log("=".repeat(60))

  const pages = [
    "/dashboard", "/trade-evaluator", "/trade-finder", "/trade-history",
    "/waiver-ai", "/rankings", "/dynasty-trade-analyzer", "/mock-draft-simulator",
    "/ai-lab", "/leagues", "/legacy", "/af-legacy", "/login", "/brackets",
  ]

  const loadResults: TestResult[] = []
  for (const page of pages) {
    const r = await runBatch(`${BASE_URL}${page}`, "GET", null, TOTAL)
    r.name = page
    loadResults.push(r)
    const codeStr = Object.entries(r.statusCodes).map(([k, v]) => `${k}:${v}`).join(" ")
    console.log(`  [${r.failed === 0 ? "OK" : "!!"}] ${page.padEnd(30)} ${r.success}/${r.total}  avg=${r.avgMs}ms  p50=${r.p50Ms}ms  p95=${r.p95Ms}ms  p99=${r.p99Ms}ms  [${codeStr}]`)
  }

  console.log("\n" + "=".repeat(60))
  console.log("  PHASE 3: API ENDPOINT TESTING")
  console.log("  (1,000x non-AI | 10x AI-powered)")
  console.log("=".repeat(60))

  interface ApiTest { name: string; method: string; path: string; body?: any; iterations: number; isAI?: boolean }

  const apiTests: ApiTest[] = [
    { name: "GET /api/league/list", method: "GET", path: "/api/league/list", iterations: TOTAL },
    { name: "GET /api/players/search?q=mahomes", method: "GET", path: "/api/players/search?q=mahomes", iterations: TOTAL },
    { name: "GET /api/rankings", method: "GET", path: "/api/rankings", iterations: TOTAL },
    { name: "GET /api/rankings/adaptive", method: "GET", path: "/api/rankings/adaptive", iterations: TOTAL },
    { name: "GET /api/player-value?player=Mahomes", method: "GET", path: "/api/player-value?player=Patrick+Mahomes", iterations: TOTAL },
    { name: "GET /api/sports/trending", method: "GET", path: "/api/sports/trending", iterations: TOTAL },
    { name: "GET /api/sports/news", method: "GET", path: "/api/sports/news", iterations: TOTAL },
    { name: "GET /api/sports/injuries", method: "GET", path: "/api/sports/injuries", iterations: TOTAL },
    { name: "GET /api/sports/live-scores", method: "GET", path: "/api/sports/live-scores", iterations: TOTAL },
    { name: "GET /api/bracket/tournaments", method: "GET", path: "/api/bracket/tournaments", iterations: TOTAL },
    { name: "GET /api/bracket/public-pools", method: "GET", path: "/api/bracket/public-pools", iterations: TOTAL },
    { name: "GET /api/bracket/global-rankings", method: "GET", path: "/api/bracket/global-rankings", iterations: TOTAL },
    { name: "GET /api/bracket/feed", method: "GET", path: "/api/bracket/feed", iterations: TOTAL },
    { name: "GET /api/legacy/players", method: "GET", path: "/api/legacy/players", iterations: TOTAL },
    { name: "GET /api/legacy/devy-board", method: "GET", path: "/api/legacy/devy-board", iterations: TOTAL },
    { name: "POST /api/analytics/track", method: "POST", path: "/api/analytics/track", body: { event: "stress_test", path: "/test", meta: { test: true } }, iterations: TOTAL },
    { name: "POST /api/trade-evaluator [AI]", method: "POST", path: "/api/trade-evaluator", body: { give: ["Patrick Mahomes"], get: ["Josh Allen"], leagueId: LEAGUE_IDS[0], leagueSize: 16, isDynasty: true, scoring: "ppr" }, iterations: 10, isAI: true },
    { name: "POST /api/waiver-ai [AI]", method: "POST", path: "/api/waiver-ai", body: { playerName: "Tank Dell", leagueId: LEAGUE_IDS[0], week: 5 }, iterations: 10, isAI: true },
    { name: "POST /api/ai/chat [AI]", method: "POST", path: "/api/ai/chat", body: { message: "Trade value of Mahomes in dynasty?", sleeperUsername: USERNAME }, iterations: 10, isAI: true },
    { name: "POST /api/dynasty-trade-analyzer [AI]", method: "POST", path: "/api/dynasty-trade-analyzer", body: { give: ["Breece Hall"], get: ["Bijan Robinson"], leagueId: LEAGUE_IDS[1] }, iterations: 10, isAI: true },
    { name: "POST /api/trade-finder [AI]", method: "POST", path: "/api/trade-finder", body: { leagueId: LEAGUE_IDS[0], sleeperUsername: USERNAME }, iterations: 10, isAI: true },
    { name: "POST /api/rankings/manager-psych [AI]", method: "POST", path: "/api/rankings/manager-psychology", body: { leagueId: LEAGUE_IDS[0], sleeperUsername: USERNAME }, iterations: 10, isAI: true },
    { name: "POST /api/roster/analyze [AI]", method: "POST", path: "/api/roster/analyze", body: { leagueId: LEAGUE_IDS[0] }, iterations: 10, isAI: true },
    { name: "POST /api/instant/trade [AI]", method: "POST", path: "/api/instant/trade", body: { give: ["CeeDee Lamb"], get: ["Ja'Marr Chase", "2026 2nd"], isDynasty: true, scoring: "ppr", leagueSize: 12 }, iterations: 10, isAI: true },
    { name: "POST /api/redraft-trade [AI]", method: "POST", path: "/api/redraft-trade", body: { give: ["Tyreek Hill"], get: ["Amon-Ra St. Brown"], leagueSize: 12, scoring: "ppr" }, iterations: 10, isAI: true },
    { name: "POST /api/legacy/player-profile", method: "POST", path: "/api/legacy/player-profile", body: { playerName: "Patrick Mahomes" }, iterations: TOTAL },
    { name: "POST /api/legacy/player-stock", method: "POST", path: "/api/legacy/player-stock", body: { playerName: "Patrick Mahomes" }, iterations: TOTAL },
  ]

  const apiResults: TestResult[] = []
  for (const test of apiTests) {
    const r = await runBatch(`${BASE_URL}${test.path}`, test.method, test.body, test.iterations)
    const label = test.isAI ? `[AI-${test.iterations}x]` : `[${test.iterations}x]`
    r.name = `${label} ${test.name}`
    apiResults.push(r)
    const codeStr = Object.entries(r.statusCodes).map(([k, v]) => `${k}:${v}`).join(" ")
    console.log(`  [${r.failed === 0 ? "OK" : "!!"}] ${r.name.padEnd(48)} ${r.success}/${r.total}  avg=${r.avgMs}ms  p95=${r.p95Ms}ms  [${codeStr}]`)

    if (test.isAI) await new Promise(r => setTimeout(r, 1000))
  }

  console.log("\n\n" + "=".repeat(70))
  console.log("  ALLFANTASY LEGACY STRESS TEST - FINAL REPORT")
  console.log("  User: theciege24 | " + new Date().toISOString())
  console.log("=".repeat(70))

  console.log("\n  --- PHASE 1: DATA SEEDING (completed earlier) ---")
  console.log("    11,002 total records seeded across 13 tables")

  console.log("\n  --- PHASE 2: PAGE LOAD TEST (1,000x each) ---")
  console.log(`    ${"Page".padEnd(30)} ${"OK".padStart(6)} ${"Fail".padStart(6)} ${"Avg".padStart(8)} ${"P50".padStart(8)} ${"P95".padStart(8)} ${"P99".padStart(8)} ${"Status Codes".padStart(20)}`)
  console.log("    " + "-".repeat(90))
  let totalPageOk = 0, totalPageFail = 0
  for (const r of loadResults) {
    totalPageOk += r.success; totalPageFail += r.failed
    const codeStr = Object.entries(r.statusCodes).map(([k, v]) => `${k}:${v}`).join(" ")
    console.log(`    ${r.name.padEnd(30)} ${String(r.success).padStart(6)} ${String(r.failed).padStart(6)} ${(r.avgMs + "ms").padStart(8)} ${(r.p50Ms + "ms").padStart(8)} ${(r.p95Ms + "ms").padStart(8)} ${(r.p99Ms + "ms").padStart(8)} ${codeStr.padStart(20)}`)
  }
  console.log("    " + "-".repeat(90))
  console.log(`    ${"TOTAL".padEnd(30)} ${String(totalPageOk).padStart(6)} ${String(totalPageFail).padStart(6)}`)
  console.log(`    Success Rate: ${((totalPageOk / (totalPageOk + totalPageFail)) * 100).toFixed(2)}%`)

  console.log("\n  --- PHASE 3: API ENDPOINT TEST ---")
  console.log(`    ${"Endpoint".padEnd(50)} ${"OK".padStart(6)} ${"Fail".padStart(6)} ${"Avg".padStart(8)} ${"P95".padStart(8)} ${"Codes".padStart(20)}`)
  console.log("    " + "-".repeat(100))
  let totalApiOk = 0, totalApiFail = 0
  for (const r of apiResults) {
    totalApiOk += r.success; totalApiFail += r.failed
    const codeStr = Object.entries(r.statusCodes).map(([k, v]) => `${k}:${v}`).join(" ")
    console.log(`    ${r.name.padEnd(50)} ${String(r.success).padStart(6)} ${String(r.failed).padStart(6)} ${(r.avgMs + "ms").padStart(8)} ${(r.p95Ms + "ms").padStart(8)} ${codeStr.padStart(20)}`)
  }
  console.log("    " + "-".repeat(100))
  console.log(`    ${"TOTAL".padEnd(50)} ${String(totalApiOk).padStart(6)} ${String(totalApiFail).padStart(6)}`)
  console.log(`    Success Rate: ${((totalApiOk / (totalApiOk + totalApiFail)) * 100).toFixed(2)}%`)

  const errorEndpoints = [...loadResults, ...apiResults].filter(r => r.failed > 0)
  if (errorEndpoints.length > 0) {
    console.log("\n  --- ERROR DETAILS ---")
    for (const r of errorEndpoints) {
      console.log(`    ${r.name}: ${r.failed} failures`)
      for (const e of r.errors) console.log(`      - ${e}`)
    }
  }

  console.log("\n" + "=".repeat(70))
  console.log(`  GRAND TOTAL:`)
  console.log(`    Phase 1: 11,002 records seeded`)
  console.log(`    Phase 2: ${totalPageOk + totalPageFail} page requests (${totalPageOk} ok, ${totalPageFail} failed)`)
  console.log(`    Phase 3: ${totalApiOk + totalApiFail} API requests (${totalApiOk} ok, ${totalApiFail} failed)`)
  console.log(`    Combined: ${11002 + totalPageOk + totalPageFail + totalApiOk + totalApiFail} total operations`)
  console.log("=".repeat(70) + "\n")
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
