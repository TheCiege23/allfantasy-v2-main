/**
 * Phase 3.7 — Recommendations Center live.ts integration tests.
 *
 * Following the established pattern (Mission Control, League Health,
 * Manager Intelligence).
 *
 * ⚠ THIS HEADER USED TO SAY `getQueue()` "cannot honestly complete today" and that "the
 * observable result is always the honest degraded error". That stopped being true when the four
 * unsourced fields (confidence/expectedImpact/primaryActionLabel/status) became optional on the
 * contract, and the module began returning the recommendations it fetches instead of discarding
 * them. The tests below were left asserting the old behaviour and went red; the header that
 * justified them was the reason they read as correct.
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

import { liveRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/live"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

function withActiveLeague(leagueId = "lg-1") {
  getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
  prismaMock.league.findMany.mockResolvedValue([{ id: leagueId, status: "active" }])
}

describe("Recommendations Center live.ts — isLiveReady gating", () => {
  it("not-yet-integrated placeholder when isLiveReady is false, without touching session/prisma/transport", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveRecommendationsClient.getQueue()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "recommendations", retryable: false })
    expect(result.source).toBe("live")
    expect(getServerSessionMock).not.toHaveBeenCalled()
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })
})

describe("Recommendations Center live.ts — active-league resolution", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("resolves no active league (no session) → honest placeholder, never calls the transport", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const result = await liveRecommendationsClient.getQueue()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "recommendations" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("resolves no active league (session present, zero non-archived rosters) → honest placeholder", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
    prismaMock.league.findMany.mockResolvedValue([{ id: "lg-archived", status: "ARCHIVED" }])
    const result = await liveRecommendationsClient.getQueue()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "recommendations" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("resolves the most recent non-archived league and calls the real /league route with it, correctly encoded", async () => {
    withActiveLeague("lg live/one")
    callDecisionOSMock.mockResolvedValue({ data: { data: { recommendations: [] } }, error: null })
    await liveRecommendationsClient.getQueue()
    expect(prismaMock.league.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }))
    expect(callDecisionOSMock).toHaveBeenCalledWith("recommendations", `/api/v1/intelligence/league?leagueId=${encodeURIComponent("lg live/one")}`)
  })
})

describe("Recommendations Center live.ts — the real pipeline runs and returns what it fetched", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  /*
   * 🛑 THESE TWO ASSERTED THAT A SUCCESSFUL CALL RETURNS NULL, AND THE MODULE STOPPED DOING
   * THAT DELIBERATELY. `getQueue` used to discard every recommendation it had just fetched because
   * it could not populate `confidence`, `expectedImpact`, `primaryActionLabel` and `status`. Those
   * four are now optional on the contract, so a complete recommendation is no longer withheld to
   * protect four fields nothing computes — see live.ts's own note. Measured on a real league, two
   * critical retention recommendations were being dropped, and with them the Activity Stream and
   * Notification Center that compose over this queue.
   *
   * The honesty rule is unchanged and is what these now assert: every rendered field traces to a
   * backend value, and the unsourced ones are OMITTED rather than defaulted.
   */
  it("returns the recommendations it fetched, omitting the fields no backend computes", async () => {
    callDecisionOSMock.mockResolvedValue({
      data: { data: { recommendations: [{ recommendationId: "rec-1", priority: "high", category: "retention", message: "2 managers at risk" }] } },
      error: null,
    })
    const result = await liveRecommendationsClient.getQueue()

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(1)
    const rec = result.data?.[0]
    expect(rec?.id).toBe("rec-1")
    expect(rec?.rationale).toBe("2 managers at risk")
    expect(rec?.severity).toBe("elevated")
    // Absent, not defaulted — a fabricated confidence is the thing this module refuses to invent.
    expect(rec).not.toHaveProperty("confidence")
    expect(rec).not.toHaveProperty("expectedImpact")
    expect(rec).not.toHaveProperty("primaryActionLabel")
    expect(rec).not.toHaveProperty("status")
  })

  it("returns an empty queue, not an error, when the league genuinely has no recommendations", async () => {
    callDecisionOSMock.mockResolvedValue({ data: { data: { recommendations: [] } }, error: null })
    const result = await liveRecommendationsClient.getQueue()
    // "Nothing needs your attention" is an answer. Reporting it as an upstream failure would send
    // a commissioner looking for a problem with the product instead.
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it("a real transport failure is passed straight through, not masked by the capability-gap error", async () => {
    const transportError = { category: "unauthorized" as const, message: "Unknown API key.", moduleId: "recommendations" as const, retryable: false, timestamp: new Date().toISOString() }
    callDecisionOSMock.mockResolvedValue({ data: null, error: transportError })
    const result = await liveRecommendationsClient.getQueue()
    expect(result.error).toEqual(transportError)
  })

  it("every result carries source='live' and a valid ISO timestamp", async () => {
    callDecisionOSMock.mockResolvedValue({ data: { data: { recommendations: [] } }, error: null })
    const result = await liveRecommendationsClient.getQueue()
    expect(result.source).toBe("live")
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })
})
