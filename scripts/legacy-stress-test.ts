import { PrismaClient } from "@prisma/client"
import { randomUUID } from "crypto"

const prisma = new PrismaClient()

const USER_ID = "6a0faf22-6bfa-4484-8acc-c6618028e334"
const USERNAME = "theciege24"
const LEAGUE_IDS = [
  "509cc54f-fedf-4d8a-b1e2-a6fb4bfd40b8",
  "f1b731f3-db1e-4214-bc39-bc07cda13efb",
]
const SLEEPER_LEAGUE_IDS = ["1313588237159141376", "1314275221502427136"]
const LEAGUE_NAMES = ["NFC Dreaming!", "Going Deep League"]
const BATCH = 100
const TOTAL = 1000
const BASE_URL = process.env.BASE_URL || "http://localhost:3000"

const NFL_PLAYERS = [
  "Patrick Mahomes", "Josh Allen", "Lamar Jackson", "Joe Burrow", "Jalen Hurts",
  "CJ Stroud", "Caleb Williams", "Anthony Richardson", "Jordan Love", "Jayden Daniels",
  "Bijan Robinson", "Breece Hall", "Jahmyr Gibbs", "Jonathan Taylor", "Saquon Barkley",
  "De'Von Achane", "Josh Jacobs", "Derrick Henry", "Kyren Williams", "Kenneth Walker",
  "Ja'Marr Chase", "CeeDee Lamb", "Tyreek Hill", "Amon-Ra St. Brown", "Justin Jefferson",
  "Garrett Wilson", "Marvin Harrison Jr.", "Drake London", "Puka Nacua", "Nico Collins",
  "Malik Nabers", "Chris Olave", "DeVonta Smith", "Davante Adams", "AJ Brown",
  "Travis Kelce", "Sam LaPorta", "Mark Andrews", "Dallas Goedert", "George Kittle",
  "TJ Watt", "Micah Parsons", "Myles Garrett", "Nick Bosa", "Maxx Crosby",
  "Sauce Gardner", "Patrick Surtain II", "Roquan Smith", "Fred Warner", "Derwin James",
  "Dexter Lawrence", "Quinnen Williams", "Jalen Ramsey", "Minkah Fitzpatrick", "Bobby Wagner",
  "Brock Bowers", "Trey McBride", "Tank Dell", "Zay Flowers", "Keenan Allen",
  "James Cook", "Travis Etienne", "Rachaad White", "Aaron Jones", "Alvin Kamara",
  "DK Metcalf", "Cooper Kupp", "Mike Evans", "Stefon Diggs", "DJ Moore"
]

const TRADE_VERDICTS = ["SMASH ACCEPT", "LEAN ACCEPT", "FAIR TRADE", "LEAN DECLINE", "HARD DECLINE"]
const TRADE_TIERS = ["Tier 1: Slam Dunk", "Tier 2: Solid", "Tier 3: Fair", "Tier 4: Unfavorable"]
const WAIVER_OUTCOMES = ["starter", "bust", "flex_play", "stash", "dropped"]
const CHAT_TITLES = [
  "Trade advice for my RBs", "Should I sell high on Mahomes?", "Dynasty startup strategy",
  "Waiver wire week 5 analysis", "Rebuild plan for my team", "Best buy-low candidates",
  "Contender or pretender analysis", "Playoff roster optimization", "Keeper decision help",
  "Superflex value of QBs", "IDP scoring strategy", "Mock draft review",
  "Counter offer ideas", "Trade block analysis", "Win-now roster moves"
]
const RISK_MODES = ["conservative", "moderate", "aggressive", "balanced"]
const TONE_MODES = ["professional", "casual", "analytical", "strategic"]
const DETAIL_LEVELS = ["concise", "detailed", "comprehensive"]
const HUMOR_LEVELS = ["none", "low", "medium", "high"]

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min }

interface TestResult {
  name: string
  total: number
  success: number
  failed: number
  avgMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  errors: string[]
}

function computeStats(name: string, times: number[], errors: string[]): TestResult {
  const sorted = [...times].sort((a, b) => a - b)
  const total = sorted.length + errors.length
  return {
    name,
    total,
    success: sorted.length,
    failed: errors.length,
    avgMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
    p50Ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.5)]) : 0,
    p95Ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)]) : 0,
    p99Ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.99)]) : 0,
    errors: errors.slice(0, 5),
  }
}

async function phase1_seedData() {
  console.log("\n" + "=".repeat(60))
  console.log("  PHASE 1: SEED 1,000 RECORDS PER LEGACY TOOL TABLE")
  console.log("=".repeat(60))

  const results: { table: string; count: number; timeMs: number }[] = []

  async function seedTable(name: string, fn: () => Promise<number>) {
    const start = Date.now()
    const count = await fn()
    const elapsed = Date.now() - start
    results.push({ table: name, count, timeMs: elapsed })
    console.log(`  [OK] ${name}: ${count} records (${elapsed}ms)`)
  }

  await seedTable("waiver_pickups", async () => {
    const data = Array.from({ length: TOTAL }, (_, i) => ({
      userId: USER_ID,
      leagueId: LEAGUE_IDS[i % 2],
      playerName: pick(NFL_PLAYERS),
      outcome: pick(WAIVER_OUTCOMES),
      week: randInt(1, 18),
      year: pick([2024, 2025, 2026]),
    }))
    for (let b = 0; b < data.length; b += BATCH * 5) {
      await prisma.waiverPickup.createMany({ data: data.slice(b, b + BATCH * 5) })
    }
    return data.length
  })

  await seedTable("mock_drafts", async () => {
    let count = 0
    for (let b = 0; b < TOTAL; b += BATCH) {
      const batch = Math.min(BATCH, TOTAL - b)
      for (let i = 0; i < batch; i++) {
        const picks = Array.from({ length: randInt(10, 15) }, (_, r) => ({
          round: r + 1,
          pick: randInt(1, 14),
          player: pick(NFL_PLAYERS),
          position: pick(["QB", "RB", "WR", "TE"]),
          isAI: Math.random() < 0.5,
        }))
        await prisma.mockDraft.create({
          data: {
            leagueId: LEAGUE_IDS[b % 2],
            userId: USER_ID,
            rounds: randInt(10, 20),
            results: { picks, score: randInt(60, 100) },
            proposals: Math.random() < 0.3 ? { tradeUp: true, cost: "2025 2nd" } : undefined,
          },
        })
        count++
      }
      if ((b + BATCH) % 500 === 0) console.log(`    ...${b + batch} mock drafts`)
    }
    return count
  })

  await seedTable("chat_conversations", async () => {
    const data = Array.from({ length: TOTAL }, () => ({
      userId: USER_ID,
      sleeperUsername: USERNAME,
      title: pick(CHAT_TITLES),
      messageCount: randInt(1, 50),
      lastMessageAt: new Date(Date.now() - randInt(0, 30 * 86400000)),
      dataSources: { sleeper: true, espn: Math.random() < 0.3, news: Math.random() < 0.5 },
    }))
    for (let b = 0; b < data.length; b += BATCH * 5) {
      await prisma.chatConversation.createMany({ data: data.slice(b, b + BATCH * 5) })
    }
    return data.length
  })

  await seedTable("trade_suggestion_votes", async () => {
    const data = Array.from({ length: TOTAL }, () => {
      const given = pickN(NFL_PLAYERS, randInt(1, 3))
      const received = pickN(NFL_PLAYERS.filter(p => !given.includes(p)), randInt(1, 3))
      return {
        userId: USER_ID,
        tradeText: `Give: ${given.join(", ")} | Get: ${received.join(", ")}`,
        suggestionTitle: `${pick(TRADE_VERDICTS)} - ${pick(TRADE_TIERS)}`,
        suggestionText: `This trade ${pick(["favors", "slightly favors", "significantly favors"])} the ${pick(["giving", "receiving"])} side.`,
        vote: pick(["UP", "DOWN"]),
        reason: Math.random() < 0.5 ? pick(["OVERVALUED", "TOO_RISKY", "NOT_MY_STYLE", "BAD_ROSTER_FIT", "OTHER"]) : null,
        leagueSize: pick([10, 12, 14, 16]),
        isDynasty: Math.random() < 0.6,
        scoring: pick(["ppr", "half_ppr", "standard", "ppr_superflex"]),
        userContention: pick(["contender", "rebuilder", "middle_of_pack"]),
      }
    })
    for (let b = 0; b < data.length; b += BATCH * 5) {
      await prisma.tradeSuggestionVote.createMany({ data: data.slice(b, b + BATCH * 5) })
    }
    return data.length
  })

  await seedTable("trade_feedback (Feedback)", async () => {
    const data = Array.from({ length: TOTAL }, () => {
      const given = pickN(NFL_PLAYERS, randInt(1, 3))
      const received = pickN(NFL_PLAYERS.filter(p => !given.includes(p)), randInt(1, 3))
      return {
        userId: USER_ID,
        tradeText: `Give: ${given.join(", ")} | Get: ${received.join(", ")}`,
        suggestionTitle: pick(TRADE_VERDICTS),
        suggestionText: `AI analysis suggests this is a ${pick(["strong", "fair", "risky", "lopsided"])} trade.`,
        vote: pick(["UP", "DOWN"]) as "UP" | "DOWN",
        reason: pick(["OVERVALUED", "TOO_RISKY", "NOT_MY_STYLE", "BAD_ROSTER_FIT", "OTHER"]) as any,
        leagueSize: pick([10, 12, 14, 16]),
        isDynasty: Math.random() < 0.6,
        scoring: pick(["ppr", "half_ppr", "standard"]),
        userContention: pick(["contender", "rebuilder", "middle_of_pack"]),
      }
    })
    for (let b = 0; b < data.length; b += BATCH * 5) {
      await prisma.feedback.createMany({ data: data.slice(b, b + BATCH * 5) })
    }
    return data.length
  })

  await seedTable("TradeNotification", async () => {
    const data = Array.from({ length: TOTAL }, (_, i) => {
      const given = pickN(NFL_PLAYERS, randInt(1, 3))
      const received = pickN(NFL_PLAYERS.filter(p => !given.includes(p)), randInt(1, 3))
      return {
        userId: USER_ID,
        leagueId: LEAGUE_IDS[i % 2],
        sleeperLeagueId: SLEEPER_LEAGUE_IDS[i % 2],
        transactionId: `test_txn_${randomUUID()}`,
        status: pick(["pending", "analyzed", "dismissed"]),
        type: "trade",
        senderRosterId: randInt(1, 16),
        senderName: pick(["TeamAlpha", "DynastyKing", "TradeGuru", "ChampBuilder", USERNAME]),
        receiverRosterId: randInt(1, 16),
        receiverName: pick(["TeamBeta", "RookieHunter", "WaiverWire", "ContenderX", USERNAME]),
        playersGiven: given.map(p => ({ name: p, position: pick(["QB", "RB", "WR", "TE"]) })),
        playersReceived: received.map(p => ({ name: p, position: pick(["QB", "RB", "WR", "TE"]) })),
        picksGiven: Math.random() < 0.3 ? [{ round: randInt(1, 4), year: pick([2025, 2026, 2027]) }] : [],
        picksReceived: Math.random() < 0.3 ? [{ round: randInt(1, 4), year: pick([2025, 2026, 2027]) }] : [],
        aiGrade: pick(["A+", "A", "B+", "B", "C+", "C", "D", "F"]),
        aiVerdict: pick(TRADE_VERDICTS),
        aiAnalysis: { tier: pick(TRADE_TIERS), confidence: randInt(60, 99) / 100, reasoning: "Test analysis" },
        sleeperCreatedAt: new Date(Date.now() - randInt(0, 90 * 86400000)),
      }
    })
    for (let b = 0; b < data.length; b += BATCH) {
      await prisma.tradeNotification.createMany({ data: data.slice(b, b + BATCH), skipDuplicates: true })
    }
    return data.length
  })

  await seedTable("LeagueTradeHistory + LeagueTrade", async () => {
    let tradeCount = 0
    for (let h = 0; h < 20; h++) {
      const sleeperLid = SLEEPER_LEAGUE_IDS[h % 2]
      const uname = h < 2 ? USERNAME : `testmanager${h}`
      const existing = await prisma.leagueTradeHistory.findUnique({
        where: { sleeperLeagueId_sleeperUsername: { sleeperLeagueId: sleeperLid, sleeperUsername: uname } }
      })
      if (existing) {
        await prisma.leagueTrade.deleteMany({ where: { historyId: existing.id } })
        await prisma.leagueTradeHistory.delete({ where: { id: existing.id } })
      }
      const history = await prisma.leagueTradeHistory.create({
        data: {
          sleeperLeagueId: sleeperLid,
          sleeperUsername: uname,
          status: "complete",
          tradesLoaded: 50,
          totalTradesFound: 50,
          lastWeekFetched: 18,
          tradingStyle: { riskLevel: pick(RISK_MODES), preference: pick(["youth", "win_now", "balanced"]) },
          tradeFrequency: pick(["high", "moderate", "low"]),
        },
      })

      const trades = Array.from({ length: 50 }, (_, t) => {
        const given = pickN(NFL_PLAYERS, randInt(1, 3))
        const received = pickN(NFL_PLAYERS.filter(p => !given.includes(p)), randInt(1, 3))
        return {
          historyId: history.id,
          transactionId: `test_trade_${randomUUID()}`,
          week: randInt(1, 18),
          season: pick([2024, 2025, 2026]),
          playersGiven: given.map(p => ({ name: p, pos: pick(["QB", "RB", "WR", "TE"]) })),
          playersReceived: received.map(p => ({ name: p, pos: pick(["QB", "RB", "WR", "TE"]) })),
          picksGiven: Math.random() < 0.3 ? [{ round: randInt(1, 4), year: 2026 }] : [],
          picksReceived: Math.random() < 0.3 ? [{ round: randInt(1, 4), year: 2026 }] : [],
          partnerRosterId: randInt(1, 16),
          partnerName: pick(["TeamAlpha", "DynastyKing", "RookieHunter"]),
          valueGiven: randInt(2000, 12000) / 100,
          valueReceived: randInt(2000, 12000) / 100,
          tradeDate: new Date(Date.now() - randInt(0, 365 * 86400000)),
          analyzed: Math.random() < 0.7,
          isSuperFlex: Math.random() < 0.4,
          leagueFormat: pick(["dynasty", "redraft"]),
          scoringType: pick(["ppr", "half_ppr", "standard"]),
        }
      })
      await prisma.leagueTrade.createMany({ data: trades })
      tradeCount += trades.length
    }
    return tradeCount
  })

  await seedTable("trade_analysis_snapshots", async () => {
    const data = Array.from({ length: TOTAL }, () => ({
      leagueId: pick(SLEEPER_LEAGUE_IDS),
      sleeperUsername: USERNAME,
      snapshotType: pick(["trade_eval", "roster_analysis", "waiver_analysis", "trade_finder"]),
      contextKey: `ctx_${randInt(1, 100)}`,
      payloadJson: {
        players: pickN(NFL_PLAYERS, randInt(2, 5)),
        verdict: pick(TRADE_VERDICTS),
        confidence: randInt(50, 99),
        timestamp: new Date().toISOString(),
      },
      season: pick([2025, 2026]),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    }))
    for (let b = 0; b < data.length; b += BATCH * 5) {
      await prisma.tradeAnalysisSnapshot.createMany({ data: data.slice(b, b + BATCH * 5) })
    }
    return data.length
  })

  await seedTable("AIUserProfile", async () => {
    try {
      await prisma.aIUserProfile.upsert({
        where: { userId: USER_ID },
        update: {
          sleeperUsername: USERNAME,
          toneMode: pick(TONE_MODES),
          detailLevel: pick(DETAIL_LEVELS),
          riskMode: pick(RISK_MODES),
          humorLevel: pick(HUMOR_LEVELS),
          strategyBias: { qb_priority: Math.random(), rb_aversion: Math.random(), prefers_picks: Math.random(), prefers_youth: Math.random() },
          behaviorMetrics: { draft_reach_tendency: randInt(1, 100) / 100, trade_rate_percentile: randInt(1, 100), waiver_rate_percentile: randInt(1, 100) },
        },
        create: {
          userId: USER_ID,
          sleeperUsername: USERNAME,
          toneMode: pick(TONE_MODES),
          detailLevel: pick(DETAIL_LEVELS),
          riskMode: pick(RISK_MODES),
          humorLevel: pick(HUMOR_LEVELS),
        },
      })
    } catch {}
    return 1
  })

  await seedTable("trade_profiles", async () => {
    await prisma.tradeProfile.upsert({
      where: { userId: USER_ID },
      update: {
        summary: "Aggressive dynasty trader who favors youth and draft picks. Frequently targets breakout WRs and elite TEs. Known for packaging veterans to acquire future assets. Risk tolerance: High. Preferred league format: Superflex PPR.",
        voteCount: randInt(50, 500),
      },
      create: {
        userId: USER_ID,
        summary: "Aggressive dynasty trader who favors youth and draft picks.",
        voteCount: randInt(50, 500),
      },
    })
    return 1
  })

  await seedTable("AnalyticsEvent", async () => {
    const events = ["page_view", "trade_evaluated", "waiver_analyzed", "chat_opened", "mock_draft_started",
      "ranking_viewed", "player_searched", "trade_shared", "bracket_pick", "league_synced"]
    const paths = ["/dashboard", "/trade-evaluator", "/waiver-ai", "/rankings", "/mock-draft-simulator",
      "/dynasty-trade-analyzer", "/ai-lab", "/brackets", "/trade-finder", "/trade-history"]
    const data = Array.from({ length: TOTAL }, () => ({
      event: pick(events),
      path: pick(paths),
      userId: USER_ID,
      sessionId: randomUUID(),
      toolKey: pick(["trade_eval", "waiver_ai", "chimmy", "rankings", "mock_draft", "bracket", null]),
      meta: { device: pick(["mobile", "desktop", "tablet"]), browser: pick(["chrome", "safari", "firefox"]) },
    }))
    for (let b = 0; b < data.length; b += BATCH * 5) {
      await prisma.analyticsEvent.createMany({ data: data.slice(b, b + BATCH * 5) })
    }
    return data.length
  })

  await seedTable("InsightEvent", async () => {
    const types = ["trade_insight", "waiver_insight", "ranking_shift", "injury_alert", "trending_player", "value_change"]
    const data = Array.from({ length: TOTAL }, () => ({
      eventType: pick(types),
      insightId: randomUUID(),
      insightType: pick(["recommendation", "alert", "analysis", "projection"]),
      confidenceLevel: pick(["high", "medium", "low"]),
      confidenceScore: String(randInt(50, 99)),
      leagueId: pick(LEAGUE_IDS),
      sport: "NFL",
      scoringType: pick(["ppr", "half_ppr", "standard"]),
      userId: USER_ID,
      metadata: { player: pick(NFL_PLAYERS), action: pick(["buy", "sell", "hold"]) },
    }))
    for (let b = 0; b < data.length; b += BATCH * 5) {
      await prisma.insightEvent.createMany({ data: data.slice(b, b + BATCH * 5) })
    }
    return data.length
  })

  await seedTable("DecisionLog", async () => {
    const decisionTypes = ["trade", "waiver", "start_sit", "roster_move", "draft_pick"]
    const data = Array.from({ length: TOTAL }, () => ({
      userId: USER_ID,
      leagueId: pick(LEAGUE_IDS),
      decisionType: pick(decisionTypes),
      aiRecommendation: { action: pick(["accept", "decline", "counter"]), player: pick(NFL_PLAYERS), reasoning: "Test recommendation" },
      confidenceScore: randInt(50, 99) / 100,
      numericConfidence: randInt(50, 99),
      riskProfile: pick(["low", "medium", "high", "extreme"]),
      volatilityLabel: pick(["stable", "volatile", "unknown"]),
      volatilityScore: randInt(0, 100) / 100,
      userFollowed: Math.random() < 0.6,
      userAction: Math.random() < 0.5 ? { action: pick(["accepted", "declined", "modified"]) } : undefined,
    }))
    for (let b = 0; b < data.length; b += BATCH * 5) {
      await prisma.decisionLog.createMany({ data: data.slice(b, b + BATCH * 5) })
    }
    return data.length
  })

  console.log("\n  Phase 1 Summary:")
  console.log("  " + "-".repeat(50))
  let totalRecords = 0
  for (const r of results) {
    totalRecords += r.count
    console.log(`    ${r.table.padEnd(30)} ${String(r.count).padStart(6)} records  (${r.timeMs}ms)`)
  }
  console.log("  " + "-".repeat(50))
  console.log(`    TOTAL: ${totalRecords} records seeded`)
  return results
}

async function phase2_loadTest() {
  console.log("\n" + "=".repeat(60))
  console.log("  PHASE 2: LOAD TEST 14 LEGACY PAGE ENDPOINTS (1,000x each)")
  console.log("=".repeat(60))

  const pages = [
    "/dashboard", "/trade-evaluator", "/trade-finder", "/trade-history",
    "/waiver-ai", "/rankings", "/dynasty-trade-analyzer", "/mock-draft-simulator",
    "/ai-lab", "/leagues", "/legacy", "/af-legacy", "/login", "/brackets",
  ]

  const allResults: TestResult[] = []
  const CONCURRENCY = 20

  for (const page of pages) {
    const times: number[] = []
    const errors: string[] = []
    const url = `${BASE_URL}${page}`

    for (let batch = 0; batch < TOTAL; batch += CONCURRENCY) {
      const batchSize = Math.min(CONCURRENCY, TOTAL - batch)
      const promises = Array.from({ length: batchSize }, async () => {
        const start = Date.now()
        try {
          const res = await fetch(url, {
            headers: { "Accept": "text/html" },
            redirect: "follow",
          })
          const elapsed = Date.now() - start
          if (res.status < 500) {
            times.push(elapsed)
          } else {
            errors.push(`HTTP ${res.status}`)
          }
        } catch (err: any) {
          errors.push(err.message?.slice(0, 80) || "Unknown error")
        }
      })
      await Promise.all(promises)
    }

    const result = computeStats(page, times, errors)
    allResults.push(result)
    console.log(`  [${result.failed === 0 ? "OK" : "!!"} ] ${page.padEnd(30)} ${result.success}/${result.total} ok  avg=${result.avgMs}ms  p95=${result.p95Ms}ms  p99=${result.p99Ms}ms${result.failed > 0 ? `  ERRORS: ${result.failed}` : ""}`)
  }

  return allResults
}

async function phase3_apiTest() {
  console.log("\n" + "=".repeat(60))
  console.log("  PHASE 3: API ENDPOINT TESTING")
  console.log("  (1,000x for non-AI routes, 10x for AI routes)")
  console.log("=".repeat(60))

  const allResults: TestResult[] = []
  const CONCURRENCY = 20

  interface ApiTest {
    name: string
    method: "GET" | "POST"
    path: string
    body?: any
    iterations: number
    isAI?: boolean
  }

  const apiTests: ApiTest[] = [
    { name: "GET /api/league/list", method: "GET", path: "/api/league/list", iterations: TOTAL },
    { name: "GET /api/players/search?q=mahomes", method: "GET", path: "/api/players/search?q=mahomes", iterations: TOTAL },
    { name: "GET /api/rankings", method: "GET", path: "/api/rankings", iterations: TOTAL },
    { name: "GET /api/rankings/adaptive", method: "GET", path: "/api/rankings/adaptive", iterations: TOTAL },
    { name: "GET /api/player-value?player=Patrick+Mahomes", method: "GET", path: "/api/player-value?player=Patrick+Mahomes", iterations: TOTAL },
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
    { name: "POST /api/legacy/player-finder", method: "POST", path: "/api/legacy/player-finder", body: { query: "Who is the best dynasty QB?", leagueId: LEAGUE_IDS[0] }, iterations: TOTAL },
    { name: "POST /api/analytics/track", method: "POST", path: "/api/analytics/track", body: { event: "stress_test", path: "/test", meta: { test: true } }, iterations: TOTAL },

    { name: "POST /api/trade-evaluator (AI)", method: "POST", path: "/api/trade-evaluator", body: {
      give: ["Patrick Mahomes"], get: ["Josh Allen"], leagueId: LEAGUE_IDS[0],
      leagueSize: 16, isDynasty: true, scoring: "ppr",
    }, iterations: 10, isAI: true },
    { name: "POST /api/waiver-ai (AI)", method: "POST", path: "/api/waiver-ai", body: {
      playerName: "Tank Dell", leagueId: LEAGUE_IDS[0], week: 5,
    }, iterations: 10, isAI: true },
    { name: "POST /api/ai/chat (AI)", method: "POST", path: "/api/ai/chat", body: {
      message: "What is the trade value of Patrick Mahomes in dynasty?",
      sleeperUsername: USERNAME,
    }, iterations: 10, isAI: true },
    { name: "POST /api/dynasty-trade-analyzer (AI)", method: "POST", path: "/api/dynasty-trade-analyzer", body: {
      give: ["Breece Hall"], get: ["Bijan Robinson"], leagueId: LEAGUE_IDS[1],
    }, iterations: 10, isAI: true },
    { name: "POST /api/trade-finder (AI)", method: "POST", path: "/api/trade-finder", body: {
      leagueId: LEAGUE_IDS[0], sleeperUsername: USERNAME,
    }, iterations: 10, isAI: true },
    { name: "POST /api/rankings/manager-psychology (AI)", method: "POST", path: "/api/rankings/manager-psychology", body: {
      leagueId: LEAGUE_IDS[0], sleeperUsername: USERNAME,
    }, iterations: 10, isAI: true },
    { name: "POST /api/roster/analyze (AI)", method: "POST", path: "/api/roster/analyze", body: {
      leagueId: LEAGUE_IDS[0],
    }, iterations: 10, isAI: true },
    { name: "POST /api/instant/trade (AI)", method: "POST", path: "/api/instant/trade", body: {
      give: ["CeeDee Lamb"], get: ["Ja'Marr Chase", "2026 2nd"], isDynasty: true, scoring: "ppr", leagueSize: 12,
    }, iterations: 10, isAI: true },
  ]

  for (const test of apiTests) {
    const times: number[] = []
    const errors: string[] = []
    const url = `${BASE_URL}${test.path}`
    const label = test.isAI ? `[AI-${test.iterations}x]` : `[${test.iterations}x]`

    for (let batch = 0; batch < test.iterations; batch += CONCURRENCY) {
      const batchSize = Math.min(CONCURRENCY, test.iterations - batch)
      const promises = Array.from({ length: batchSize }, async () => {
        const start = Date.now()
        try {
          const options: RequestInit = {
            method: test.method,
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
          }
          if (test.method === "POST" && test.body) {
            options.body = JSON.stringify(test.body)
          }
          const res = await fetch(url, options)
          const elapsed = Date.now() - start
          if (res.status < 500) {
            times.push(elapsed)
          } else {
            const text = await res.text().catch(() => "")
            errors.push(`HTTP ${res.status}: ${text.slice(0, 100)}`)
          }
        } catch (err: any) {
          errors.push(err.message?.slice(0, 80) || "Unknown error")
        }
      })
      await Promise.all(promises)

      if (test.isAI && test.iterations > 5) {
        await new Promise(r => setTimeout(r, 500))
      }
    }

    const result = computeStats(`${label} ${test.name}`, times, errors)
    allResults.push(result)
    const status = result.failed === 0 ? "OK" : result.failed < result.total / 2 ? "WN" : "!!"
    console.log(`  [${status}] ${result.name.padEnd(48)} ${result.success}/${result.total}  avg=${result.avgMs}ms  p95=${result.p95Ms}ms${result.failed > 0 ? `  ERR:${result.failed}` : ""}`)
  }

  return allResults
}

function printFinalReport(seedResults: any[], loadResults: TestResult[], apiResults: TestResult[]) {
  console.log("\n\n" + "=".repeat(70))
  console.log("  ALLFANTASY LEGACY STRESS TEST - FINAL REPORT")
  console.log("  User: theciege24 | " + new Date().toISOString())
  console.log("=".repeat(70))

  console.log("\n  --- PHASE 1: DATA SEEDING ---")
  let totalSeeded = 0
  for (const r of seedResults) {
    totalSeeded += r.count
    console.log(`    ${r.table.padEnd(30)} ${String(r.count).padStart(6)} records  (${r.timeMs}ms)`)
  }
  console.log(`    ${"TOTAL".padEnd(30)} ${String(totalSeeded).padStart(6)} records`)

  console.log("\n  --- PHASE 2: PAGE LOAD TEST (1,000x each) ---")
  console.log(`    ${"Page".padEnd(30)} ${"Success".padStart(8)} ${"Failed".padStart(8)} ${"Avg(ms)".padStart(8)} ${"P50(ms)".padStart(8)} ${"P95(ms)".padStart(8)} ${"P99(ms)".padStart(8)}`)
  console.log("    " + "-".repeat(80))
  let totalPageSuccess = 0, totalPageFailed = 0
  for (const r of loadResults) {
    totalPageSuccess += r.success
    totalPageFailed += r.failed
    console.log(`    ${r.name.padEnd(30)} ${String(r.success).padStart(8)} ${String(r.failed).padStart(8)} ${String(r.avgMs).padStart(8)} ${String(r.p50Ms).padStart(8)} ${String(r.p95Ms).padStart(8)} ${String(r.p99Ms).padStart(8)}`)
  }
  console.log("    " + "-".repeat(80))
  console.log(`    ${"TOTAL".padEnd(30)} ${String(totalPageSuccess).padStart(8)} ${String(totalPageFailed).padStart(8)}`)

  console.log("\n  --- PHASE 3: API ENDPOINT TEST ---")
  console.log(`    ${"Endpoint".padEnd(50)} ${"OK".padStart(6)} ${"Fail".padStart(6)} ${"Avg".padStart(6)} ${"P95".padStart(6)}`)
  console.log("    " + "-".repeat(76))
  let totalApiSuccess = 0, totalApiFailed = 0
  for (const r of apiResults) {
    totalApiSuccess += r.success
    totalApiFailed += r.failed
    console.log(`    ${r.name.padEnd(50)} ${String(r.success).padStart(6)} ${String(r.failed).padStart(6)} ${String(r.avgMs).padStart(6)} ${String(r.p95Ms).padStart(6)}`)
  }
  console.log("    " + "-".repeat(76))
  console.log(`    ${"TOTAL".padEnd(50)} ${String(totalApiSuccess).padStart(6)} ${String(totalApiFailed).padStart(6)}`)

  const errorEndpoints = [...loadResults, ...apiResults].filter(r => r.failed > 0)
  if (errorEndpoints.length > 0) {
    console.log("\n  --- ERROR DETAILS ---")
    for (const r of errorEndpoints) {
      console.log(`    ${r.name}:`)
      for (const e of r.errors) {
        console.log(`      - ${e}`)
      }
    }
  }

  console.log("\n" + "=".repeat(70))
  console.log(`  GRAND TOTAL: ${totalSeeded} records seeded | ${totalPageSuccess + totalApiSuccess} requests OK | ${totalPageFailed + totalApiFailed} failed`)
  console.log("=".repeat(70) + "\n")
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗")
  console.log("║   ALLFANTASY LEGACY STRESS TEST - ALL 3 PHASES             ║")
  console.log("║   User: theciege24                                         ║")
  console.log("║   1,000 iterations per test                                ║")
  console.log("╚══════════════════════════════════════════════════════════════╝")

  const seedResults = await phase1_seedData()
  const loadResults = await phase2_loadTest()
  const apiResults = await phase3_apiTest()

  printFinalReport(seedResults, loadResults, apiResults)
}

main()
  .catch((e) => {
    console.error("Fatal error:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
