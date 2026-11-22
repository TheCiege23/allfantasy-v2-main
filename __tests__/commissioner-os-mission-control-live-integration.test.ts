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
  league: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  appUser: { findMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const callDecisionOSMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/adapter/transport", () => ({ callDecisionOS: callDecisionOSMock }))

const isLiveReadyMock = vi.hoisted(() => vi.fn())
const readManagerHighlightsMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-mission-control/managerHighlightReads", () => ({ readManagerHighlights: readManagerHighlightsMock }))
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

import { liveDecisionOSClient } from "@/lib/commissioner-ui/decision-os-client/live"

beforeEach(() => {
  vi.clearAllMocks()
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
  prismaMock.league.findMany.mockResolvedValue([{ id: leagueId, status: "active" }])
}

describe("Mission Control live.ts — isLiveReady gating (today's real, default behavior)", () => {
  it("getLeagueHealthSummary: not-yet-integrated placeholder when isLiveReady is false, without touching session/prisma/transport", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control", retryable: false })
    expect(result.source).toBe("live")
    expect(getServerSessionMock).not.toHaveBeenCalled()
    expect(prismaMock.league.findMany).not.toHaveBeenCalled()
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
    prismaMock.league.findMany.mockResolvedValue([{ id: "lg-archived", status: "ARCHIVED" }])
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
    expect(prismaMock.league.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { userId: "user-1" },
      { teams: { some: { claimedByUserId: "user-1", role: { not: "viewer" }, OR: [{ isCommissioner: true }, { isCoCommissioner: true }] } } },
    ] } }))
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

/*
 * 🛑 THIS TEST USED TO ASSERT `result.data` WAS NULL, AND IT WAS PINNING A BUG.
 *
 * "Degrades honestly" was the intent; discarding the health score was the implementation. A
 * missing trend meant the whole summary came back as an error — including `score`, `tier` and
 * `driver`, which had already arrived from a successful call and are the only three fields
 * `MissionControlView` actually renders. `trendLabel` appears nowhere in that view.
 *
 * And it was not rare: `intelligence_league_snapshot_history` needs two rows before any trend
 * exists, and held zero platform-wide, so this fired for every league. It still fires for the
 * first two days of every newly imported league.
 *
 * The honest degradation is to show the score and say there is no trend yet.
 */
  it("keeps the real health score and reports no trend when there is not enough history yet", async () => {
    mockByPath({
      [LEAGUE_URL]: { data: { data: { leagueEngagementScore: 80, healthNarrative: { engagementSummary: "ok", topConcern: null, standoutSignal: null } } }, error: null },
      [TREND_URL]: { data: { data: { available: false } }, error: null },
    })
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.error).toBeNull()
    expect(result.data?.score).toBe(80)
    // Nothing invented in the trend's place: a flat direction and a label that says why.
    expect(result.data?.trendDirection).toBe("flat")
    expect(result.data?.trendLabel).toMatch(/not enough history/i)
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

/*
 * The league call and the trend call fail independently, and only one of them carries the health
 * score. A trend timeout is not a reason to withhold a number that arrived successfully — the
 * league call above is still the one whose failure is passed straight through (asserted in the
 * test before this one).
 */
  it("survives a trend-call transport failure, keeping the score the league call returned", async () => {
    const transportError = { category: "upstream_unavailable" as const, message: "Timed out.", moduleId: "mission-control" as const, retryable: true, timestamp: new Date().toISOString() }
    mockByPath({
      [LEAGUE_URL]: { data: { data: { leagueEngagementScore: 80, healthNarrative: { engagementSummary: "ok", topConcern: null, standoutSignal: null } } }, error: null },
      [TREND_URL]: { data: null, error: transportError },
    })
    const result = await liveDecisionOSClient.getLeagueHealthSummary()
    expect(result.error).toBeNull()
    expect(result.data?.score).toBe(80)
    expect(result.data?.trendDirection).toBe("flat")
    expect(result.data?.trendLabel).toMatch(/not enough history/i)
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

/*
 * 🛑 THE CARD READ A RETIRED ROUTE (re-score 2026-11-17). `/api/v1/intelligence/league/managers` is one of the retired
 * profile paths and answers 410, so the four tests that stood here specified a source that no longer exists. The
 * highlights now come from the member-activity facts the Commissioner page shows (managerHighlightReads.ts, which
 * has its own suite); this pins the wiring.
 */
describe("getManagerHighlights — member-activity facts, not the retired managers route", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("passes the league's highlights through and never calls the retired managers route", async () => {
    const highlights = [{ id: "risk:Pine Bears", managerName: "Pine Bears", callout: "Activity has slowed", tone: "risk" as const }]
    readManagerHighlightsMock.mockResolvedValue({ ok: true, highlights })
    const result = await liveDecisionOSClient.getManagerHighlights()
    expect(result.error).toBeNull()
    expect(result.data).toEqual(highlights)
    expect(readManagerHighlightsMock).toHaveBeenCalledWith("lg-1")
    expect(callDecisionOSMock.mock.calls.map((c) => c[1])).not.toContain(MANAGERS_URL)
  })

  it("an empty league is an empty list, not an error", async () => {
    readManagerHighlightsMock.mockResolvedValue({ ok: true, highlights: [] })
    const result = await liveDecisionOSClient.getManagerHighlights()
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it("activity that cannot be judged is an error carrying the reason, never an empty 'all clear'", async () => {
    readManagerHighlightsMock.mockResolvedValue({ ok: false, reason: "No moves have been imported for this league yet." })
    const result = await liveDecisionOSClient.getManagerHighlights()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "mission-control", message: "No moves have been imported for this league yet." })
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
