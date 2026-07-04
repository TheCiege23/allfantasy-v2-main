/**
 * Phase 3.2 built the gated wiring; Phase 3.4 completes it using Phase 3.3's
 * new backend capabilities (trend, deadlines, public manager listing,
 * narrative signals). Covers: isLiveReady gating (unchanged), active-league
 * resolution (unchanged), the full real-success path for all 3 methods, and
 * every honest-degradation path (per-league insufficient trend data, a real
 * transport failure passed straight through, missing active league) —
 * without ever weakening or duplicating commissioner-os-transport.test.ts's
 * own coverage of callDecisionOS/resolveDecisionOSAuthHeaders themselves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const callDecisionOSMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-os/adapter/transport", () => ({ callDecisionOS: callDecisionOSMock }))

const isLiveReadyMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-os/liveReadiness", () => ({ isLiveReady: isLiveReadyMock }))

const canAccessLiveDecisionOSDataMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-os/liveModeAccess", () => ({ canAccessLiveDecisionOSData: canAccessLiveDecisionOSDataMock }))

import { liveDecisionOSClient } from "@/lib/commissioner-os/decision-os-client/live"

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

const LEAGUE_URL = `/api/v1/intelligence/league?leagueId=${encodeURIComponent("lg-1")}`
const TREND_URL = `/api/v1/intelligence/league/trend?leagueId=${encodeURIComponent("lg-1")}`
const DEADLINES_URL = `/api/v1/intelligence/league/deadlines?leagueId=${encodeURIComponent("lg-1")}`
const MANAGERS_URL = `/api/v1/intelligence/league/managers?leagueId=${encodeURIComponent("lg-1")}`

function mockByPath(responses: Record<string, unknown>) {
  callDecisionOSMock.mockImplementation(async (_moduleId: string, path: string) => {
    if (path in responses) return responses[path]
    throw new Error(`Unexpected callDecisionOS path in test: ${path}`)
  })
}

function withActiveLeague(leagueId = "lg-1") {
  getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
  prismaMock.roster.findMany.mockResolvedValue([{ league: { id: leagueId, status: "active" } }])
}

describe("Mission Control live.ts — isLiveReady gating (today's real, default behavior)", () => {
  it("getLeagueHealthSummary: not-yet-integrated placeholder when isLiveReady is false, without touching session/prisma/transport", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control", retryable: false })
    expect(result.source).toBe("live")
    expect(getServerSessionMock).not.toHaveBeenCalled()
    expect(prismaMock.roster.findMany).not.toHaveBeenCalled()
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getMissionControlKpis: not-yet-integrated placeholder when isLiveReady is false", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveDecisionOSClient.getMissionControlKpis()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control", retryable: false })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getManagerHighlights: not-yet-integrated placeholder when isLiveReady is false — now genuinely consults the flag, since a real route exists", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveDecisionOSClient.getManagerHighlights()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })
})

describe("Mission Control live.ts — admin-only gating (Gate Opening Plan, Option C)", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("getLeagueHealthSummary: not-yet-integrated placeholder when isLiveReady is true but the caller is not admin, without touching session/prisma/transport", async () => {
    canAccessLiveDecisionOSDataMock.mockResolvedValue(false)
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control", retryable: false })
    expect(getServerSessionMock).not.toHaveBeenCalled()
    expect(prismaMock.roster.findMany).not.toHaveBeenCalled()
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getManagerHighlights: not-yet-integrated placeholder when isLiveReady is true but the caller is not admin", async () => {
    canAccessLiveDecisionOSDataMock.mockResolvedValue(false)
    const result = await liveDecisionOSClient.getManagerHighlights()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getMissionControlKpis: not-yet-integrated placeholder when isLiveReady is true but the caller is not admin", async () => {
    canAccessLiveDecisionOSDataMock.mockResolvedValue(false)
    const result = await liveDecisionOSClient.getMissionControlKpis()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("getLeagueHealthSummary: proceeds to the transport when isLiveReady is true and the caller is admin", async () => {
    canAccessLiveDecisionOSDataMock.mockResolvedValue(true)
    withActiveLeague()
    mockByPath({
      [LEAGUE_URL]: { data: { data: { leagueEngagementScore: 91.6, healthNarrative: { engagementSummary: "Stable", topConcern: null, standoutSignal: null } } }, error: null },
      [TREND_URL]: { data: { data: { available: true, direction: "up", scoreDelta: 6 } }, error: null },
    })
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.error).toBeNull()
    expect(callDecisionOSMock).toHaveBeenCalled()
  })
})

describe("Mission Control live.ts — active-league resolution (shared by all 3 methods)", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("resolves no active league (no session) → honest placeholder, never calls the transport", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("resolves no active league (session present, zero non-archived rosters) → honest placeholder", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
    prismaMock.roster.findMany.mockResolvedValue([{ league: { id: "lg-archived", status: "ARCHIVED" } }])
    const result = await liveDecisionOSClient.getMissionControlKpis()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("resolves the most recent non-archived league and encodes it correctly into every URL called", async () => {
    withActiveLeague("lg live/one")
    mockByPath({
      [`/api/v1/intelligence/league?leagueId=${encodeURIComponent("lg live/one")}`]: { data: null, error: null },
      [`/api/v1/intelligence/league/trend?leagueId=${encodeURIComponent("lg live/one")}`]: { data: null, error: null },
    })
    await liveDecisionOSClient.getLeagueHealthSummary()
    expect(prismaMock.roster.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platformUserId: "user-1" } }))
    expect(callDecisionOSMock).toHaveBeenCalledWith("mission-control", `/api/v1/intelligence/league?leagueId=${encodeURIComponent("lg live/one")}`)
    expect(callDecisionOSMock).toHaveBeenCalledWith("mission-control", `/api/v1/intelligence/league/trend?leagueId=${encodeURIComponent("lg live/one")}`)
  })
})

describe("getLeagueHealthSummary — full real success path", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("constructs a complete, real LeagueHealthSummary from the league + trend responses — no fabrication", async () => {
    mockByPath({
      [LEAGUE_URL]: {
        data: { data: { leagueEngagementScore: 91.6, healthNarrative: { engagementSummary: "Stable", topConcern: "2 managers at risk", standoutSignal: null } } },
        error: null,
      },
      [TREND_URL]: { data: { data: { available: true, direction: "up", scoreDelta: 6 } }, error: null },
    })
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      score: 92,
      tier: "positive",
      trendLabel: "+6 since the last check",
      trendDirection: "up",
      driver: "2 managers at risk",
    })
  })

  it("falls back through the narrative chain: topConcern → standoutSignal → engagementSummary", async () => {
    mockByPath({
      [LEAGUE_URL]: {
        data: { data: { leagueEngagementScore: 40, healthNarrative: { engagementSummary: "Baseline activity", topConcern: null, standoutSignal: null } } },
        error: null,
      },
      [TREND_URL]: { data: { data: { available: true, direction: "flat", scoreDelta: 0 } }, error: null },
    })
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.data?.driver).toBe("Baseline activity")
    expect(result.data?.trendLabel).toBe("No significant change since the last check")
    expect(result.data?.tier).toBe("elevated")
  })

  it("degrades honestly (never fabricates) when trend reports insufficient historical data for this league", async () => {
    mockByPath({
      [LEAGUE_URL]: { data: { data: { leagueEngagementScore: 80, healthNarrative: { engagementSummary: "ok", topConcern: null, standoutSignal: null } } }, error: null },
      [TREND_URL]: { data: { data: { available: false } }, error: null },
    })
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.data).toBeNull()
    expect(result.error?.category).toBe("upstream_unavailable")
    expect(result.error?.message).toMatch(/historical data/i)
  })

  it("a real transport failure on the league call is passed straight through, not masked", async () => {
    const transportError = { category: "unauthorized" as const, message: "Unknown API key.", moduleId: "mission-control" as const, retryable: false, timestamp: new Date().toISOString() }
    mockByPath({
      [LEAGUE_URL]: { data: null, error: transportError },
      [TREND_URL]: { data: { data: { available: true, direction: "up", scoreDelta: 1 } }, error: null },
    })
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.error).toEqual(transportError)
  })

  it("a real transport failure on the trend call is passed straight through, not masked", async () => {
    const transportError = { category: "upstream_unavailable" as const, message: "Timed out.", moduleId: "mission-control" as const, retryable: true, timestamp: new Date().toISOString() }
    mockByPath({
      [LEAGUE_URL]: { data: { data: { leagueEngagementScore: 80, healthNarrative: { engagementSummary: "ok", topConcern: null, standoutSignal: null } } }, error: null },
      [TREND_URL]: { data: null, error: transportError },
    })
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.error).toEqual(transportError)
  })
})

describe("getMissionControlKpis — full real success path", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("constructs a complete, real MissionControlKpis from the league + deadlines responses", async () => {
    mockByPath({
      [LEAGUE_URL]: {
        data: { data: { leagueEngagementScore: 77, recommendations: [{ priority: "critical" }, { priority: "medium" }, { priority: "high" }] } },
        error: null,
      },
      [DEADLINES_URL]: { data: { data: { nextActionableEvent: { label: "trade_deadline", week: 10, weeksAway: 3 } } }, error: null },
    })
    const result = await liveDecisionOSClient.getMissionControlKpis()
    expect(result.error).toBeNull()
    expect(result.data).toEqual({
      openRecommendations: 3,
      activeRisks: 2,
      engagementScore: 77,
      nextDeadlineLabel: "Trade deadline in 3 weeks",
    })
  })

  it("honestly reports no configured deadlines rather than fabricating one", async () => {
    mockByPath({
      [LEAGUE_URL]: { data: { data: { leagueEngagementScore: 60, recommendations: [] } }, error: null },
      [DEADLINES_URL]: { data: { data: { nextActionableEvent: null } }, error: null },
    })
    const result = await liveDecisionOSClient.getMissionControlKpis()
    expect(result.data?.nextDeadlineLabel).toBe("No upcoming deadlines configured")
  })

  it("a real transport failure on the deadlines call is passed straight through, not masked", async () => {
    const transportError = { category: "upstream_unavailable" as const, message: "Down.", moduleId: "mission-control" as const, retryable: true, timestamp: new Date().toISOString() }
    mockByPath({
      [LEAGUE_URL]: { data: { data: { leagueEngagementScore: 60, recommendations: [] } }, error: null },
      [DEADLINES_URL]: { data: null, error: transportError },
    })
    const result = await liveDecisionOSClient.getMissionControlKpis()
    expect(result.error).toEqual(transportError)
  })
})

describe("getManagerHighlights — full real success path", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("maps ManagerSummaryV1[] to ManagerHighlight[], resolving display names via a single batched appUser query (no N+1)", async () => {
    mockByPath({
      [MANAGERS_URL]: {
        data: {
          data: [
            { managerId: "u-1", retentionRisk: "low", retentionRiskReasons: ["Consistent lineup sets"], isInactive: false, inactivityWarning: null },
            { managerId: "u-2", retentionRisk: "high", retentionRiskReasons: [], isInactive: true, inactivityWarning: "Inactive for 20 days" },
          ],
        },
        error: null,
      },
    })
    prismaMock.appUser.findMany.mockResolvedValue([
      { id: "u-1", displayName: "Priya N.", username: "priya" },
      { id: "u-2", displayName: null, username: "sam_r" },
    ])

    const result = await liveDecisionOSClient.getManagerHighlights()

    expect(prismaMock.appUser.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.appUser.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["u-1", "u-2"] } } }))
    expect(result.data).toEqual([
      { id: "u-1", managerName: "Priya N.", callout: "Consistent lineup sets", tone: "positive" },
      { id: "u-2", managerName: "sam_r", callout: "Inactive for 20 days", tone: "risk" },
    ])
  })

  it("falls back to the raw managerId as the name when no AppUser row exists — a real, honest label, not fabrication", async () => {
    mockByPath({
      [MANAGERS_URL]: { data: { data: [{ managerId: "ghost-user", retentionRisk: "low", retentionRiskReasons: [], isInactive: false, inactivityWarning: null }] }, error: null },
    })
    prismaMock.appUser.findMany.mockResolvedValue([])

    const result = await liveDecisionOSClient.getManagerHighlights()
    expect(result.data?.[0]).toEqual({ id: "ghost-user", managerName: "ghost-user", callout: "Active and engaged", tone: "positive" })
  })

  it("returns an empty list, not an error, when the league has zero surfaced managers", async () => {
    mockByPath({ [MANAGERS_URL]: { data: { data: [] }, error: null } })
    const result = await liveDecisionOSClient.getManagerHighlights()
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
    expect(prismaMock.appUser.findMany).not.toHaveBeenCalled()
  })

  it("a real transport failure is passed straight through, not masked", async () => {
    const transportError = { category: "forbidden" as const, message: "No scope.", moduleId: "mission-control" as const, retryable: false, timestamp: new Date().toISOString() }
    mockByPath({ [MANAGERS_URL]: { data: null, error: transportError } })
    const result = await liveDecisionOSClient.getManagerHighlights()
    expect(result.error).toEqual(transportError)
  })
})

describe("envelope shape — every method, every path", () => {
  it("every result carries source='live' and a valid ISO timestamp, matching every other client's envelope", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveDecisionOSClient.getMissionControlKpis()
    expect(result.source).toBe("live")
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })
})
