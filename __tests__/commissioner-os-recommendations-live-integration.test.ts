/**
 * Phase 3.7 — Recommendations Center live.ts integration tests.
 *
 * Following the established pattern (Mission Control, League Health,
 * Manager Intelligence). `getQueue()` cannot honestly complete today (see
 * live.ts's own doc comment and
 * RECOMMENDATIONS_CENTER_LIVE_INTEGRATION_REPORT.md for the full
 * justification: title/confidence/expectedImpact/primaryActionLabel/status
 * have no real Decision OS analog, ported or not). These tests prove the
 * real pipeline still runs correctly (league resolution, the /league call)
 * even though the observable result is always the honest degraded error.
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
vi.mock("@/lib/commissioner-ui/adapter/transport", () => ({ callDecisionOS: callDecisionOSMock }))

const isLiveReadyMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/liveReadiness", () => ({ isLiveReady: isLiveReadyMock }))

import { liveRecommendationsClient } from "@/lib/commissioner-ui/recommendations/decision-os-client/live"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
})

function withActiveLeague(leagueId = "lg-1") {
  getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
  prismaMock.roster.findMany.mockResolvedValue([{ league: { id: leagueId, status: "active" } }])
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
    prismaMock.roster.findMany.mockResolvedValue([{ league: { id: "lg-archived", status: "ARCHIVED" } }])
    const result = await liveRecommendationsClient.getQueue()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "recommendations" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("resolves the most recent non-archived league and calls the real /league route with it, correctly encoded", async () => {
    withActiveLeague("lg live/one")
    callDecisionOSMock.mockResolvedValue({ data: { data: { recommendations: [] } }, error: null })
    await liveRecommendationsClient.getQueue()
    expect(prismaMock.roster.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platformUserId: "user-1" } }))
    expect(callDecisionOSMock).toHaveBeenCalledWith("recommendations", `/api/v1/intelligence/league?leagueId=${encodeURIComponent("lg live/one")}`)
  })
})

describe("Recommendations Center live.ts — the real pipeline runs, but always degrades honestly on success", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("a successful /league call with real recommendations still returns the specific 'lifecycle unavailable' error — never a fabricated queue", async () => {
    callDecisionOSMock.mockResolvedValue({
      data: { data: { recommendations: [{ recommendationId: "rec-1", priority: "high", category: "retention", message: "2 managers at risk" }] } },
      error: null,
    })
    const result = await liveRecommendationsClient.getQueue()
    expect(result.data).toBeNull()
    expect(result.error?.category).toBe("upstream_unavailable")
    expect(result.error?.message).toMatch(/title|confidence|impact|action|status/i)
  })

  it("an empty recommendations list still degrades honestly", async () => {
    callDecisionOSMock.mockResolvedValue({ data: { data: { recommendations: [] } }, error: null })
    const result = await liveRecommendationsClient.getQueue()
    expect(result.data).toBeNull()
    expect(result.error?.category).toBe("upstream_unavailable")
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
