/**
 * Phase 3.5 — League Health live.ts integration tests.
 *
 * Following Mission Control's established pattern
 * (commissioner-os-mission-control-live-integration.test.ts). Covers:
 * isLiveReady gating (all 4 methods), active-league resolution, the one
 * real success path (getEvidence), and the 3 methods deliberately left on
 * the honest placeholder because no real backend capability closes their
 * gap (getHealthDetail/getRisks/getRecommendations — see live.ts's own
 * doc comment and LEAGUE_HEALTH_LIVE_INTEGRATION_REPORT.md for the
 * field-by-field justification).
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

import { liveLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/live"

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

describe("League Health live.ts — the 3 methods that stay on the honest placeholder", () => {
  it.each(["getHealthDetail", "getRisks", "getRecommendations"] as const)(
    "%s: always the honest placeholder — isLiveReady is never even consulted, since no backend capability exists to wire it to",
    async (method) => {
      isLiveReadyMock.mockResolvedValue(true)
      const result = await liveLeagueHealthClient[method]()
      expect(result.data).toBeNull()
      expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "league-health" })
      expect(result.source).toBe("live")
      expect(isLiveReadyMock).not.toHaveBeenCalled()
      expect(callDecisionOSMock).not.toHaveBeenCalled()
    },
  )
})

describe("League Health live.ts — getEvidence gating and resolution", () => {
  it("not-yet-integrated placeholder when isLiveReady is false, without touching session/prisma/transport", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveLeagueHealthClient.getEvidence()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "league-health", retryable: false })
    expect(getServerSessionMock).not.toHaveBeenCalled()
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("resolves no active league (no session) → honest placeholder, never calls the transport", async () => {
    isLiveReadyMock.mockResolvedValue(true)
    getServerSessionMock.mockResolvedValue(null)
    const result = await liveLeagueHealthClient.getEvidence()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "league-health" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("resolves the most recent non-archived league and calls the real league route with it, correctly encoded", async () => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague("lg live/one")
    callDecisionOSMock.mockResolvedValue({
      data: { data: { healthNarrative: { engagementSummary: "ok", topConcern: null, standoutSignal: null } } },
      error: null,
    })
    await liveLeagueHealthClient.getEvidence()
    expect(prismaMock.roster.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platformUserId: "user-1" } }))
    expect(callDecisionOSMock).toHaveBeenCalledWith("league-health", `/api/v1/intelligence/league?leagueId=${encodeURIComponent("lg live/one")}`)
  })
})

describe("League Health live.ts — getEvidence full real success path", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("maps healthNarrative to evidence points — always includes engagementSummary", async () => {
    callDecisionOSMock.mockResolvedValue({
      data: { data: { healthNarrative: { engagementSummary: "Stable participation", topConcern: null, standoutSignal: null } } },
      error: null,
    })
    const result = await liveLeagueHealthClient.getEvidence()
    expect(result.error).toBeNull()
    expect(result.data).toEqual([{ label: "Engagement Summary", detail: "Stable participation" }])
  })

  it("includes Top Concern and Standout Signal as additional evidence points when present, in order", async () => {
    callDecisionOSMock.mockResolvedValue({
      data: {
        data: {
          healthNarrative: {
            engagementSummary: "Mixed signals",
            topConcern: "2 managers inactive 14+ days",
            standoutSignal: "Trade volume up 40% this month",
          },
        },
      },
      error: null,
    })
    const result = await liveLeagueHealthClient.getEvidence()
    expect(result.data).toEqual([
      { label: "Engagement Summary", detail: "Mixed signals" },
      { label: "Top Concern", detail: "2 managers inactive 14+ days" },
      { label: "Standout Signal", detail: "Trade volume up 40% this month" },
    ])
  })

  it("a real transport failure is passed straight through, not masked", async () => {
    const transportError = { category: "unauthorized" as const, message: "Unknown API key.", moduleId: "league-health" as const, retryable: false, timestamp: new Date().toISOString() }
    callDecisionOSMock.mockResolvedValue({ data: null, error: transportError })
    const result = await liveLeagueHealthClient.getEvidence()
    expect(result.error).toEqual(transportError)
  })

  it("every result carries source='live' and a valid ISO timestamp", async () => {
    callDecisionOSMock.mockResolvedValue({
      data: { data: { healthNarrative: { engagementSummary: "ok", topConcern: null, standoutSignal: null } } },
      error: null,
    })
    const result = await liveLeagueHealthClient.getEvidence()
    expect(result.source).toBe("live")
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })
})
