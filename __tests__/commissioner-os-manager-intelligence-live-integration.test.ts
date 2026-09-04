/**
 * Manager Intelligence live.ts integration tests.
 *
 * ⚠ THIS SUITE PREVIOUSLY ASSERTED THE OPPOSITE OUTCOME, AND WAS RIGHT TO. Until
 * `/api/v1/intelligence/league/manager-dna` existed, `getManagerDirectory()` made its real calls
 * and then returned an honest "the backend does not classify archetypes" error, because
 * archetype/engagementTrend/reliabilityScore had no exposed Decision OS analog. Those assertions
 * were a deliberate guard against fabricating a directory, not a placeholder.
 *
 * The route now exists and is scoped to `intelligence:league:read` (commissioner + platform tiers),
 * so the guard's condition is gone and the assertions move with it. What has NOT changed is the
 * discipline underneath them: the tests below still prove nothing is invented — `tenureSeasons`
 * stays absent because it has no source, and a manager with no snapshots gets no trend rather than
 * a fabricated 'steady'.
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
vi.mock("@/lib/commissioner-ui/adapter/transport", () => ({ callDecisionOS: callDecisionOSMock }))

const isLiveReadyMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/commissioner-ui/liveReadiness", () => ({ isLiveReady: isLiveReadyMock }))

import { liveManagerIntelligenceClient } from "@/lib/commissioner-ui/managers/decision-os-client/live"

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

/** A directory row as the route returns it. `engagementTrend` is a union, never a bare direction. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    managerId: "u-1",
    primaryIdentity: "serial_trader",
    engagementReliability: "reliable",
    engagementTrend: { available: true, direction: "rising" },
    ...overrides,
  }
}

function directoryResponse(rows: ReturnType<typeof row>[]) {
  return { data: { data: { available: true, rows } }, error: null }
}

describe("Manager Intelligence live.ts — isLiveReady gating", () => {
  it("not-yet-integrated placeholder when isLiveReady is false, without touching session/prisma/transport", async () => {
    isLiveReadyMock.mockResolvedValue(false)
    const result = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "managers", retryable: false })
    expect(result.source).toBe("live")
    expect(getServerSessionMock).not.toHaveBeenCalled()
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })
})

describe("Manager Intelligence live.ts — active-league resolution", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
  })

  it("resolves no active league (no session) → honest placeholder, never calls the transport", async () => {
    getServerSessionMock.mockResolvedValue(null)
    const result = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "managers" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("resolves no active league (session present, zero non-archived rosters) → honest placeholder", async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: "user-1" } })
    prismaMock.roster.findMany.mockResolvedValue([{ league: { id: "lg-archived", status: "ARCHIVED" } }])
    const result = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", moduleId: "managers" })
    expect(callDecisionOSMock).not.toHaveBeenCalled()
  })

  it("calls the manager-dna route — NOT /league/managers, which cannot answer a directory", async () => {
    withActiveLeague("lg live/one")
    callDecisionOSMock.mockResolvedValue(directoryResponse([]))
    await liveManagerIntelligenceClient.getManagerDirectory()
    expect(prismaMock.roster.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { platformUserId: "user-1" } }))
    expect(callDecisionOSMock).toHaveBeenCalledWith(
      "managers",
      `/api/v1/intelligence/league/manager-dna?leagueId=${encodeURIComponent("lg live/one")}`,
    )
  })
})

describe("Manager Intelligence live.ts — the directory is real now, and still invents nothing", () => {
  beforeEach(() => {
    isLiveReadyMock.mockResolvedValue(true)
    withActiveLeague()
  })

  it("returns a real directory with humanized archetypes, no error", async () => {
    callDecisionOSMock.mockResolvedValue(
      directoryResponse([row({ managerId: "u-1" }), row({ managerId: "u-2", primaryIdentity: "committed_grinder" })]),
    )
    prismaMock.appUser.findMany.mockResolvedValue([
      { id: "u-1", displayName: "Priya N.", username: "priya" },
      { id: "u-2", displayName: null, username: "sam_r" },
    ])

    const result = await liveManagerIntelligenceClient.getManagerDirectory()

    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(2)
    expect(result.data?.[0]).toMatchObject({ id: "u-1", managerName: "Priya N.", archetype: "Active Trader" })
    // displayName null falls back to username, matching Mission Control's own resolution.
    expect(result.data?.[1]).toMatchObject({ managerName: "sam_r", archetype: "Steady Operator" })
  })

  it("OMITS tenureSeasons entirely — it has no source, and a fabricated number is worse than a gap", async () => {
    callDecisionOSMock.mockResolvedValue(directoryResponse([row()]))
    prismaMock.appUser.findMany.mockResolvedValue([{ id: "u-1", displayName: "A", username: "a" }])

    const result = await liveManagerIntelligenceClient.getManagerDirectory()

    expect(result.data?.[0]).not.toHaveProperty("tenureSeasons")
    expect(result.data?.[0]).not.toHaveProperty("reliabilityScore")
    // The real ordinal classification is passed through in its place.
    expect(result.data?.[0]?.engagementReliability).toBe("reliable")
  })

  it("omits engagementTrend when the backend has no direction — never back-fills 'steady'", async () => {
    callDecisionOSMock.mockResolvedValue(
      directoryResponse([
        row({ managerId: "u-1", engagementTrend: { available: false, reason: "no_snapshots" } }),
        row({ managerId: "u-2", engagementTrend: { available: true, direction: "declining" } }),
      ]),
    )
    prismaMock.appUser.findMany.mockResolvedValue([])

    const result = await liveManagerIntelligenceClient.getManagerDirectory()

    expect(result.data?.[0]).not.toHaveProperty("engagementTrend")
    expect(result.data?.[1]?.engagementTrend).toBe("declining")
  })

  it("frames a risk flag as league continuity, never as a judgment about the person", async () => {
    callDecisionOSMock.mockResolvedValue(
      directoryResponse([
        row({ managerId: "u-1", engagementReliability: "unreliable" }),
        row({ managerId: "u-2", engagementTrend: { available: true, direction: "declining" } }),
        row({ managerId: "u-3" }),
      ]),
    )
    prismaMock.appUser.findMany.mockResolvedValue([])

    const result = await liveManagerIntelligenceClient.getManagerDirectory()

    expect(result.data?.[0]?.riskFlag).toMatch(/check-in/i)
    expect(result.data?.[1]?.riskFlag).toMatch(/declining/i)
    // A healthy manager carries no flag at all — the field is a signal, not a slot to fill.
    expect(result.data?.[2]).not.toHaveProperty("riskFlag")
  })

  it("still resolves manager display names via a single batched appUser query", async () => {
    callDecisionOSMock.mockResolvedValue(directoryResponse([row({ managerId: "u-1" }), row({ managerId: "u-2" })]))
    prismaMock.appUser.findMany.mockResolvedValue([])

    await liveManagerIntelligenceClient.getManagerDirectory()

    expect(prismaMock.appUser.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.appUser.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["u-1", "u-2"] } } }))
  })

  it("keeps a manager with no AppUser row in the directory rather than under-reporting the league", async () => {
    callDecisionOSMock.mockResolvedValue(directoryResponse([row({ managerId: "u-ghost" })]))
    prismaMock.appUser.findMany.mockResolvedValue([])

    const result = await liveManagerIntelligenceClient.getManagerDirectory()

    expect(result.data).toHaveLength(1)
    expect(result.data?.[0]?.managerName).toBe("Unknown manager")
  })

  it("an empty league is an empty directory, not an error", async () => {
    callDecisionOSMock.mockResolvedValue(directoryResponse([]))
    const result = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
    expect(prismaMock.appUser.findMany).not.toHaveBeenCalled()
  })

  it("a backend that could not compute reports a RETRYABLE error, distinct from not-integrated", async () => {
    callDecisionOSMock.mockResolvedValue({ data: { data: { available: false } }, error: null })
    const result = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ category: "upstream_unavailable", retryable: true })
  })

  it("a real transport failure is passed straight through, not masked", async () => {
    const transportError = { category: "unauthorized" as const, message: "Unknown API key.", moduleId: "managers" as const, retryable: false, timestamp: new Date().toISOString() }
    callDecisionOSMock.mockResolvedValue({ data: null, error: transportError })
    const result = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(result.error).toEqual(transportError)
  })

  it("every result carries source='live' and a valid ISO timestamp", async () => {
    callDecisionOSMock.mockResolvedValue(directoryResponse([]))
    const result = await liveManagerIntelligenceClient.getManagerDirectory()
    expect(result.source).toBe("live")
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false)
  })
})
