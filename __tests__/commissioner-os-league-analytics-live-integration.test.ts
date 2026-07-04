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

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const callDecisionOSMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-os/adapter/transport", () => ({ callDecisionOS: callDecisionOSMock }))

const isLiveReadyMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-os/liveReadiness", () => ({ isLiveReady: isLiveReadyMock }))

const canAccessLiveDecisionOSDataMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-os/liveModeAccess", () => ({ canAccessLiveDecisionOSData: canAccessLiveDecisionOSDataMock }))

import { liveAnalyticsClient } from "@/lib/commissioner-os/analytics/decision-os-client/live"

beforeEach(() => {
  vi.clearAllMocks()
  // Every existing "real data" test below predates the admin gate and is
  // implicitly exercising an authorized caller's path — default it on here
  // so those tests keep proving what they always proved. The dedicated
  // "admin gating" describe block below overrides this per-test.
  canAccessLiveDecisionOSDataMock.mockResolvedValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
})

function withActiveLeague(leagueId = "lg-1") {
  getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
  prismaMock.roster.findMany.mockResolvedValue([{ league: { id: leagueId, status: "active" } }])
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

describe("League Analytics live.ts — admin-only gating (Gate Opening Plan, Option C)", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("getSnapshot: not-yet-integrated placeholder when isLiveReady is true but the caller is not admin, without ever touching prisma/transport", async () => {
    canAccessLiveDecisionOSDataMock.mockResolvedValue(false)
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "analytics", retryable: false })
    expect(prismaMock.roster.findMany).not.toHaveBeenCalled()
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getSummary: not-yet-integrated placeholder when isLiveReady is true but the caller is not admin", async () => {
    canAccessLiveDecisionOSDataMock.mockResolvedValue(false)
    const result = await liveAnalyticsClient.getSummary()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "analytics" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getSnapshot: proceeds to the transport when isLiveReady is true and the caller is admin", async () => {
    canAccessLiveDecisionOSDataMock.mockResolvedValue(true)
    withActiveLeague()
    mockByPath({ "/league/trend": TREND_AVAILABLE, "/league": LEAGUE_INTEL })
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.error).toBeNull()
    expect(callDecisionOSMock).toHaveBeenCalled()
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
      { id: "kpi-active-managers", label: "Active Managers", value: "9 of 12" },
      { id: "kpi-trade-activity", label: "Trade Activity", value: "Moderate" },
      { id: "kpi-waiver-activity", label: "Waiver Activity", value: "High" },
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

  it("a real /league transport failure is passed straight through, even if /league/trend would have succeeded", async () => {
    const transportError = { category: "unauthorized" as const, message: "Unknown API key.", moduleId: "analytics" as const, retryable: false, timestamp: new Date().toISOString() }
    callDecisionOSMock.mockImplementation((_moduleId: string, path: string) => {
      if (path.includes("/league/trend")) return Promise.resolve(TREND_AVAILABLE.data ? { data: TREND_AVAILABLE, error: null } : { data: null, error: null })
      return Promise.resolve({ data: null, error: transportError })
    })
    const result = await liveAnalyticsClient.getSnapshot()
    expect(result.error).toEqual(transportError)
    expect(result.data).toBeNull()
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
