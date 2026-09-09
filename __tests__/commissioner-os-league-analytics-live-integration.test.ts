/**
 * Phase 3.10 — League Analytics live.ts integration tests.
 *
 * Unlike Workspace (3.8) and Automation Center (3.9), this module has a
 * genuinely partial real outcome: `kpis`/`trends` are built from real
 * `/league` + `/league/trend` data, while the other five snapshot fields
 * stay honestly empty (no Decision OS or wireable application-layer
 * analog — see live.ts's own doc comment and
 * LEAGUE_ANALYTICS_LIVE_INTEGRATION_REPORT.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

/*
 * `league` and `leagueTeam`, not `roster`.
 *
 * 🛑 THE MOCK AND THE MODULE HAD DISAGREED SINCE `resolveActiveLeagueId` STOPPED RESOLVING BY
 * ROSTER. It now asks `prisma.league.findMany({ where: { userId } })` — commissioner-of, not
 * plays-in — while this mock still supplied only `roster`, so every test that reached it died on
 * `Cannot read properties of undefined (reading 'findMany')` before its own assertion ran. Five
 * suites, red on main.
 *
 * `leagueTeam` is the second half: `resolveManagerDisplayNames` reads it to turn a
 * `sleeper:<id>` manager key into that manager's name. It is only queried when a provider-prefixed
 * id is present, so it stays unused by the AF-uuid fixtures below and is mocked so a test that
 * adds one does not silently reach Prisma.
 */
const prismaMock = vi.hoisted(() => ({
  league: { findMany: vi.fn(), findFirst: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  /*
   * The data window. `buildKpis` labels its rolling-window KPIs "(last 90d)", and that suffix
   * only appears when `readAnalyticsDataWindow` resolves — which needs `league.findFirst` (the
   * league's provider identity) and these two reads. Without them the window came back null, the
   * suffix vanished, and this suite asserted a label the source could not produce.
   *
   * ⚠ THE SUFFIX IS THE ASSERTION, NOT DECORATION. "0 of 7 managers active" without it reads as a
   * statement about the league; with it, as a statement about a 90-day window. A mock that
   * silently drops it would let that distinction be deleted from the product under a green suite.
   */
  decisionOsImportedActivity: { findFirst: vi.fn(), groupBy: vi.fn() },
  roster: { findMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const callDecisionOSMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/adapter/transport", () => ({ callDecisionOS: callDecisionOSMock }))

const isLiveReadyMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/liveReadiness", () => ({ isLiveReady: isLiveReadyMock }))
/*
 * ⚠ MOCKED BECAUSE THE MODULE UNDER TEST CHANGED DEPENDENCY, NOT BECAUSE THESE TESTS CARE ABOUT
 * COOKIES. `resolveActiveLeagueId` gained a `cookies()` read in 440e6d39 (the Commissioner OS
 * league selector), and every suite here reaches it through its live client. Without this the
 * whole file dies on `\`cookies\` was called outside a request scope` before a single assertion
 * runs.
 *
 * `get` returns undefined, which is the no-cookie path — the "most recent roster" default these
 * assertions were written against and still describe. Returning a value here would silently
 * repoint every test at a different league.
 */
const cookieStoreMock = vi.hoisted(() => ({ get: vi.fn(() => undefined) }))
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(cookieStoreMock) }))

import { liveAnalyticsClient } from "@/lib/commissioner-ui/analytics/decision-os-client/live"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

function withActiveLeague(leagueId = "lg-1") {
  getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
  prismaMock.league.findMany.mockResolvedValue([{ id: leagueId, status: "active" }])
  prismaMock.league.findFirst.mockResolvedValue({ platform: "sleeper", platformLeagueId: "111" })
  // Recent activity, so the window resolves and the KPI labels carry their "(last 90d)" scope.
  prismaMock.decisionOsImportedActivity.findFirst.mockResolvedValue({ occurredAt: new Date() })
  prismaMock.decisionOsImportedActivity.groupBy.mockResolvedValue([
    { activityType: "trade", _count: { _all: 3 } },
    { activityType: "waiver", _count: { _all: 12 } },
  ])
}

const LEAGUE_INTEL = {
  data: {
    leagueEngagementScore: 74,
    participationDistribution: { totalManagers: 12, activeManagers: 9, inactiveManagers: 3, activePercent: 75, inactivePercent: 25 },
    tradeActivity: { tier: "moderate" as const, perManagerRate: 1.2 },
    waiverActivity: { tier: "high" as const, perManagerRate: 3.4 },
  },
}

const TREND_AVAILABLE = {
  data: {
    available: true as const,
    direction: "up" as const,
    magnitude: 4,
    scoreDelta: 4,
    previousScore: 70,
    currentScore: 74,
    capturedAt: "2026-07-01T00:00:00.000Z",
    comparedToCapturedAt: "2026-06-24T00:00:00.000Z",
  },
}

const TREND_UNAVAILABLE = {
  data: { available: false as const, reason: "insufficient_historical_data" as const, snapshotCount: 1 },
}

function mockByPath(responses: Record<string, unknown>) {
  callDecisionOSMock.mockImplementation((_moduleId: string, path: string) => {
    for (const [key, value] of Object.entries(responses)) {
      if (path.includes(key)) return Promise.resolve({ data: value, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  })
}

describe("League Analytics live.ts — isLiveReady gating", () => {
  it("getSnapshot: not-yet-integrated placeholder when isLiveReady is false, without touching session/prisma/transport", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "analytics", retryable: false })
    expect(getServerSessionMock).not.toHaveBeenCalled()
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getSummary: not-yet-integrated placeholder when isLiveReady is false", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveAnalyticsClient.getSummary()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "analytics" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })
})

describe("League Analytics live.ts — active-league resolution", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("getSnapshot: no active league (no session) → honest placeholder, never calls the transport", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "analytics" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getSnapshot: resolves the most recent non-archived league and calls both /league and /league/trend, correctly encoded", async () => {
    withActiveLeague("lg live/one")
    mockByPath({ "/league/trend": TREND_AVAILABLE, "/league": LEAGUE_INTEL })
    await liveAnalyticsClient.getSnapshot()
    expect(callDecisionOSMock).toHaveBeenCalledWith("analytics", `/api/v1/intelligence/league?leagueId=${encodeURIComponent("lg live/one")}`)
    expect(callDecisionOSMock).toHaveBeenCalledWith("analytics", `/api/v1/intelligence/league/trend?leagueId=${encodeURIComponent("lg live/one")}`)
  })
})

describe("League Analytics live.ts — getSnapshot builds real kpis/trends, honestly empty arrays for the rest", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("builds 4 real KPIs from /league data, with a real trend on the engagement KPI when trend is available", async () => {
    mockByPath({ "/league/trend": TREND_AVAILABLE, "/league": LEAGUE_INTEL })
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.error).toBeNull()
    expect(result.data?.kpis).toEqual([
      { id: "kpi-engagement", label: "League Engagement Score", value: "74", trend: { direction: "up", label: "+4 vs previous capture" } },
      // "(last 90d)" is load-bearing, not decoration: the denominator counts managers
      // with an event inside INTELLIGENCE_LOOKBACK_DAYS, not the league's team count.
      { id: "kpi-active-managers", label: "Active Managers (last 90d)", value: "9 of 12" },
      // The suffix is on all three window-derived KPIs, not just the manager count: `windowSuffix`
      // was generalised when the window stopped being hard-coded, and trade/waiver activity are
      // rolling-window readings too. Asserting it on only one of them let the other two drift.
      { id: "kpi-trade-activity", label: "Trade Activity (last 90d)", value: "Moderate" },
      { id: "kpi-waiver-activity", label: "Waiver Activity (last 90d)", value: "High" },
    ])
  })

  it("builds exactly the 2 real trend points when trend is available — never interpolates a weekly series", async () => {
    mockByPath({ "/league/trend": TREND_AVAILABLE, "/league": LEAGUE_INTEL })
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.data?.trends).toEqual([
      {
        id: "trend-engagement",
        name: "League Engagement",
        points: [
          { label: "2026-06-24T00:00:00.000Z", value: 70 },
          { label: "2026-07-01T00:00:00.000Z", value: 74 },
        ],
      },
    ])
  })

  it("omits the trend series and the engagement KPI's trend field when insufficient historical data exists", async () => {
    mockByPath({ "/league/trend": TREND_UNAVAILABLE, "/league": LEAGUE_INTEL })
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.data?.trends).toEqual([])
    expect(result.data?.kpis[0]).toEqual({ id: "kpi-engagement", label: "League Engagement Score", value: "74" })
  })

  it("never fabricates competitiveBalance, scoringDistribution, transactionsByWeek, rosterUtilization, or seasonComparison — all honestly empty", async () => {
    mockByPath({ "/league/trend": TREND_AVAILABLE, "/league": LEAGUE_INTEL })
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.data?.competitiveBalance).toEqual([])
    expect(result.data?.scoringDistribution).toEqual([])
    expect(result.data?.transactionsByWeek).toEqual([])
    expect(result.data?.rosterUtilization).toEqual([])
    expect(result.data?.seasonComparison).toEqual([])
  })

  /*
   * 🛑 THIS ASSERTED `result.data` WAS NULL, WHICH SPECIFIED THROWING AWAY ELEVEN WORKING
   * CHART SERIES TO REPORT A PROBLEM WITH FOUR NUMBERS.
   *
   * The intelligence API and the Postgres warehouse are read in parallel and fail independently.
   * Six seasons of drafts, trades, waivers and scoring do not stop being true because an HTTP hop
   * timed out — but the whole snapshot was discarded, so one upstream blip emptied the only tab in
   * Commissioner OS that draws charts.
   *
   * The intelligence half now degrades on its own and names itself in `degradedReason`.
   */
  it("keeps the warehouse series when the /league call fails, and says which half is missing", async () => {
    const transportError = { category: "unauthorized" as const, message: "Unknown API key.", moduleId: "analytics" as const, retryable: false, timestamp: new Date().toISOString() }
    callDecisionOSMock.mockImplementation((_moduleId: string, path: string) => {
      if (path.includes("/league/trend")) return Promise.resolve(TREND_AVAILABLE.data ? { data: TREND_AVAILABLE, error: null } : { data: null, error: null })
      return Promise.resolve({ data: null, error: transportError })
    })
    const result = await liveAnalyticsClient.getSnapshot()

    expect(result.data).not.toBeNull()
    // The half that failed is empty and SAID to be empty — never filled in with a guess.
    expect(result.data?.kpis).toEqual([])
    expect(result.data?.degradedReason).toMatch(/intelligence is unavailable/i)
    // The half that succeeded survived.
    expect(result.data?.activityMix.length).toBeGreaterThan(0)
  })

  it("abandons the snapshot when the /league call fails AND the warehouse has nothing to show", async () => {
    const transportError = { category: "unauthorized" as const, message: "Unknown API key.", moduleId: "analytics" as const, retryable: false, timestamp: new Date().toISOString() }
    callDecisionOSMock.mockImplementation(() => Promise.resolve({ data: null, error: transportError }))
    // No imported activity at all, so every warehouse panel is genuinely empty.
    prismaMock.decisionOsImportedActivity.groupBy.mockResolvedValue([])
    prismaMock.decisionOsImportedActivity.findFirst.mockResolvedValue(null)

    const result = await liveAnalyticsClient.getSnapshot()
    // Degrading is for partial data. With nothing on either side there is no snapshot to render,
    // and inventing an empty one would read as "your league has no history".
    expect(result.data).toBeNull()
    expect(result.error).toEqual(transportError)
  })

  it("a /league/trend failure degrades to available:false rather than failing the whole snapshot", async () => {
    callDecisionOSMock.mockImplementation((_moduleId: string, path: string) => {
      if (path.includes("/league/trend")) return Promise.resolve({ data: null, error: { category: "upstream_unavailable" as const, message: "trend down", moduleId: "analytics" as const, retryable: true, timestamp: new Date().toISOString() } })
      return Promise.resolve({ data: LEAGUE_INTEL, error: null })
    })
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.error).toBeNull()
    expect(result.data?.trends).toEqual([])
  })

  it("every result carries source='live' and a valid ISO timestamp", async () => {
    mockByPath({ "/league/trend": TREND_AVAILABLE, "/league": LEAGUE_INTEL })
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.source).toBe("live")
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })
})

describe("League Analytics live.ts — getSummary builds a real headline from real data", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("builds a real headline and kpiCount from /league data", async () => {
    callDecisionOSMock.mockResolvedValue({ data: LEAGUE_INTEL, error: null })
    const result = await liveAnalyticsClient.getSummary()
    expect(result.data).toEqual({ headline: "League engagement score 74 — 9 of 12 managers active", kpiCount: 4 })
  })

  it("a real transport failure is passed straight through", async () => {
    const transportError = { category: "upstream_unavailable" as const, message: "down", moduleId: "analytics" as const, retryable: true, timestamp: new Date().toISOString() }
    callDecisionOSMock.mockResolvedValue({ data: null, error: transportError })
    const result = await liveAnalyticsClient.getSummary()
    expect(result.error).toEqual(transportError)
  })
})
