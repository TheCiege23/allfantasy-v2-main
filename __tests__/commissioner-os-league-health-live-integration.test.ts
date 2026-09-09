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

import { liveLeagueHealthClient } from "@/lib/commissioner-ui/league-health/decision-os-client/live"

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

/*
 * 🛑 THIS BLOCK USED TO ASSERT THAT THREE OF THE FOUR METHODS ARE PERMANENT PLACEHOLDERS, "since no
 * backend capability exists to wire it to". The premise was half right: no backend computes a
 * baseline-minus-deductions decomposition, a persisted risk lifecycle, or per-recommendation
 * confidence — and the CONTRACT demanded all three, so the client could not satisfy it without
 * inventing them.
 *
 * The contract was the thing that was wrong, and the consequence of leaving it wrong was that the
 * League Health tab showed a paying commissioner an error instead of their league's condition.
 * `types.ts` is now narrowed to what the pipeline genuinely computes — one score, two banded
 * categories, a participation ratio and a data-completeness figure — and these three methods return
 * it. Nothing was fabricated to get here; a decomposition that does not exist was removed from the
 * contract rather than faked in the client.
 */
describe("League Health live.ts — the 3 methods that were placeholders now return real intelligence", () => {
  const INTEL = {
    data: {
      data: {
        leagueEngagementScore: 62.4,
        retentionRisk: "high",
        commissionerWorkload: "critical",
        participationDistribution: { activeManagers: 4, totalManagers: 9 },
        completeness: 70,
        healthNarrative: { engagementSummary: "4 of 9 managers are active", topConcern: "Two managers have gone quiet", standoutSignal: null },
      },
    },
    error: null,
  }

  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
    callDecisionOSMock.mockResolvedValue(INTEL)
  })

  it("getHealthDetail: every field traces to a value the API returned", async () => {
    const result = await liveLeagueHealthClient.getHealthDetail()
    expect(result.error).toBeNull()
    // Rounded, never truncated — 62.4 is a score of 62, not 62.4 and not 62.0.
    expect(result.data?.score).toBe(62)
    expect(result.data?.participation).toEqual({ activeManagers: 4, totalManagers: 9 })
    expect(result.data?.completeness).toBe(70)
    /*
     * The bands are mapped to severity tiers, not to numbers. `high` retention risk becoming
     * `elevated` is the mapping; becoming `71` would be invented precision.
     */
    expect(result.data?.retentionRisk).toBe("elevated")
    expect(result.data?.commissionerWorkload).toBe("critical")
  })

  it("getRisks: reports the conditions that ARE something, and nothing else", async () => {
    const result = await liveLeagueHealthClient.getRisks()
    expect(result.error).toBeNull()
    const ids = (result.data ?? []).map((r) => r.id)
    expect(ids).toContain("risk-retention")
    expect(ids).toContain("risk-workload")
    expect(ids).toContain("risk-participation")

    /*
     * ⚠ NO INVENTED AGE OR LIFECYCLE. Risks are recomputed from the current window on every request,
     * so there is no first-seen timestamp to age from. Both fields are optional on the contract and
     * must be absent rather than defaulted — a permanent "0d" would read as "found today, every day".
     */
    for (const risk of result.data ?? []) {
      expect(risk.ageInDays).toBeUndefined()
      expect(risk.status).toBeUndefined()
    }
  })

  it("getRisks: a healthy league produces an empty list, not padding", async () => {
    callDecisionOSMock.mockResolvedValue({
      data: {
        data: {
          ...INTEL.data.data,
          retentionRisk: "low",
          commissionerWorkload: "low",
          participationDistribution: { activeManagers: 9, totalManagers: 9 },
        },
      },
      error: null,
    })
    const result = await liveLeagueHealthClient.getRisks()
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it("getRecommendations: delegates rather than re-mapping the same payload", async () => {
    callDecisionOSMock.mockResolvedValue({
      data: { data: { recommendations: [{ recommendationId: "rec-1", priority: "critical", category: "retention", message: "Reach out" }] } },
      error: null,
    })
    const result = await liveLeagueHealthClient.getRecommendations()
    expect(result.error).toBeNull()
    expect(result.data?.[0]?.id).toBe("rec-1")
    /*
     * Two modules reading one payload must not carry two mappings of it. Recommendations Center owns
     * this one — including the decision to OMIT the four fields nothing computes — so the assertion
     * that matters here is that those omissions survive delegation.
     */
    expect(result.data?.[0]).not.toHaveProperty("confidence")
    expect(result.data?.[0]).not.toHaveProperty("status")
  })

  it("all three still refuse when the namespace is not live-ready", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    for (const method of ["getHealthDetail", "getRisks", "getRecommendations"] as const) {
      const result = await liveLeagueHealthClient[method]()
      expect(result.data).toBeNull()
      expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "league-health" })
    }
  })
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
    expect(prismaMock.league.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }))
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
