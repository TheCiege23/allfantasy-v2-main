/**
 * Phase 2C — RosterContextProvider tests.
 * Mocks @/lib/prisma and exercises the playerData → starters/bench projection.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  appUserFindUniqueMock,
  leagueTeamFindFirstMock,
  rosterFindFirstMock,
  weeklyScoreFindManyMock,
} = vi.hoisted(() => ({
  appUserFindUniqueMock: vi.fn(),
  leagueTeamFindFirstMock: vi.fn(),
  rosterFindFirstMock: vi.fn(),
  weeklyScoreFindManyMock: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: { findUnique: appUserFindUniqueMock },
    leagueTeam: { findFirst: leagueTeamFindFirstMock },
    roster: { findFirst: rosterFindFirstMock },
    weeklyScore: { findMany: weeklyScoreFindManyMock },
  },
}))

import { RosterContextProvider } from "@/lib/chimmy-context/providers/RosterContextProvider"
import type { ChimmyContextRequest } from "@/lib/chimmy-context/types"

function baseRequest(overrides: Partial<ChimmyContextRequest> = {}): ChimmyContextRequest {
  return {
    userId: "user-1",
    leagueId: "league-1",
    perRequestMemo: new Map<string, unknown>(),
    ...overrides,
  }
}

describe("RosterContextProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appUserFindUniqueMock.mockResolvedValue({ activeLeagueId: null })
    leagueTeamFindFirstMock.mockResolvedValue({
      id: "team-self",
      teamName: "Self",
      platformUserId: "platform-self",
    })
    weeklyScoreFindManyMock.mockResolvedValue([])
  })

  it("returns null data when leagueId cannot be resolved", async () => {
    const provider = new RosterContextProvider()
    const res = await provider.load(baseRequest({ leagueId: null }))
    expect(res.ok).toBe(true)
    expect(res.data).toBeNull()
    expect(rosterFindFirstMock).not.toHaveBeenCalled()
  })

  it("returns empty starters/bench when viewer has no platformUserId in this league", async () => {
    leagueTeamFindFirstMock.mockResolvedValueOnce({
      id: "team-self",
      teamName: "Self",
      platformUserId: null,
    })
    const provider = new RosterContextProvider()
    const res = await provider.load(baseRequest())
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({
      leagueId: "league-1",
      teamId: "team-self",
      starters: [],
      bench: [],
    })
    expect(rosterFindFirstMock).not.toHaveBeenCalled()
  })

  it("returns empty starters/bench when the Roster row is missing", async () => {
    rosterFindFirstMock.mockResolvedValueOnce(null)
    const provider = new RosterContextProvider()
    const res = await provider.load(baseRequest())
    expect(res.ok).toBe(true)
    expect(res.data?.starters).toEqual([])
    expect(res.data?.bench).toEqual([])
  })

  it("projects playerData.lineup_sections into RosterPlayerLite[]", async () => {
    rosterFindFirstMock.mockResolvedValueOnce({
      playerData: {
        lineup_sections: {
          starters: [
            { id: "p-qb", name: "Patrick Mahomes", position: "QB", team: "kc", slot: "QB" },
            { id: "p-rb1", full_name: "Christian McCaffrey", position: "rb", team: "sf" },
          ],
          bench: [{ id: "p-rb2", position: "RB", name: "Tony Pollard" }],
          ir: [{ id: "p-wr-ir", position: "WR", name: "Cooper Kupp" }],
          taxi: [],
          devy: [],
        },
      },
    })
    const provider = new RosterContextProvider()
    const res = await provider.load(baseRequest())
    expect(res.ok).toBe(true)
    expect(res.data?.starters).toHaveLength(2)
    expect(res.data?.starters[0]).toMatchObject({
      playerId: "p-qb",
      name: "Patrick Mahomes",
      position: "QB",
      team: "KC",
      slot: "QB",
    })
    expect(res.data?.starters[1]).toMatchObject({
      playerId: "p-rb1",
      name: "Christian McCaffrey",
      position: "RB",
      team: "SF",
    })
    // bench merges true bench + ir + taxi + devy
    expect(res.data?.bench.map((p) => p.playerId)).toEqual(["p-rb2", "p-wr-ir"])
  })

  /*
   * ── 🛑 THIS TEST USED TO ASSERT THE BUG, BY NAME ──────────────────────────────────────────
   *
   * It was called "falls back name=playerId when name is missing" and expected
   * `starters[0].name` to equal `"p-nameless"` — the player's own id. That is not a fallback,
   * it is a fabrication, and blessing it in a test is why it reached production: measured on a
   * live dynasty league 2026-09-01, all 27 players came back named after their ids, and Chimmy
   * was asked to answer lineup questions about someone called "6804".
   *
   * ⚠ CHANGING A TEST TO MAKE YOUR OWN CHANGE PASS NEEDS A REASON, SO HERE IT IS: the assertion
   * encoded a defect rather than a requirement. `Roster.playerData` holds the provider's bare
   * ids BY DESIGN — the schema notes that resolving at ingestion would silently discard everyone
   * who fails to bridge — so "name is missing" is the NORMAL case here, not an edge one. The old
   * expectation made the normal case indistinguishable from a real name.
   *
   * The scenario is kept exactly as written; only the expectation is inverted.
   */
  it("🛑 leaves name null when it cannot be resolved — an id is not a name", async () => {
    rosterFindFirstMock.mockResolvedValueOnce({
      playerData: {
        lineup_sections: {
          starters: [{ id: "p-nameless", position: "WR" }],
          bench: [],
          ir: [],
          taxi: [],
          devy: [],
        },
      },
    })
    const provider = new RosterContextProvider()
    const res = await provider.load(baseRequest())
    // Null, never the id back again. The grounding packet turns an all-null roster into
    // `unresolved_identity` — a gap a model can see, rather than a name it will trust.
    expect(res.data?.starters[0].name).toBeNull()
    // ⚠ The control: the row must still be THERE. A fix that dropped unresolvable players would
    // trade a false name for a missing team-mate, which is the worse of the two.
    expect(res.data?.starters[0].playerId).toBe("p-nameless")
  })

  it("returns ok:false with null data when Roster.findFirst throws synchronously", async () => {
    rosterFindFirstMock.mockImplementationOnce(() => {
      throw new Error("sync boom")
    })
    const provider = new RosterContextProvider()
    const res = await provider.load(baseRequest())
    expect(res.ok).toBe(false)
    expect(res.data).toBeNull()
    expect(res.error).toBe("sync boom")
  })

  it("(Batch 4 Sub-batch C) skips WeeklyScore read when season/week missing and leaves projections null", async () => {
    rosterFindFirstMock.mockResolvedValueOnce({
      id: "roster-self",
      playerData: {
        lineup_sections: {
          starters: [
            { id: "p-qb", name: "QB1", position: "QB" },
            { id: "p-rb1", name: "RB1", position: "RB" },
          ],
          bench: [
            { id: "p-rb2", name: "RB2", position: "RB" },
            { id: "p-rb3", name: "RB3", position: "RB" },
          ],
          ir: [],
          taxi: [],
          devy: [],
        },
      },
    })
    const provider = new RosterContextProvider()
    const res = await provider.load(baseRequest())
    expect(weeklyScoreFindManyMock).not.toHaveBeenCalled()
    expect(res.data?.starterProjectedTotal).toBeNull()
    // Intel still ran on positional fallbacks: byPosition + depth populated.
    expect(res.data?.byPosition).toMatchObject({ QB: 17, RB: 12 })
    expect(res.data?.depthByPosition).toMatchObject({
      QB: { starters: 1, bench: 0 },
      RB: { starters: 1, bench: 2 },
    })
    expect(res.data?.teamIdentityHint).toBe("unknown")
  })

  it("(Batch 4 Sub-batch C) wires WeeklyScore projections and surfaces depth + strength signals", async () => {
    rosterFindFirstMock.mockResolvedValueOnce({
      id: "roster-self",
      playerData: {
        lineup_sections: {
          starters: [
            { id: "p-qb", name: "QB1", position: "QB" },
            { id: "p-rb1", name: "RB1", position: "RB" },
            { id: "p-wr1", name: "WR1", position: "WR" },
          ],
          bench: [
            { id: "p-rb2", name: "RB2", position: "RB" },
            { id: "p-rb3", name: "RB3", position: "RB" },
            { id: "p-rb4", name: "RB4", position: "RB" },
            { id: "p-rb5", name: "RB5", position: "RB" },
          ],
          ir: [],
          taxi: [],
          devy: [],
        },
      },
    })
    weeklyScoreFindManyMock.mockResolvedValueOnce([
      { playerId: "p-qb", points: 0, statLine: { projection: 25 } },
      { playerId: "p-rb1", points: 0, statLine: { projection: 18 } },
      { playerId: "p-wr1", points: 0, statLine: { projection: 6 } }, // weak
    ])
    const provider = new RosterContextProvider()
    const res = await provider.load(
      baseRequest({ season: 2025, week: 5 })
    )
    expect(weeklyScoreFindManyMock).toHaveBeenCalledTimes(1)
    expect(res.data?.starterProjectedTotal).toBe(49) // 25 + 18 + 6
    expect(res.data?.byPosition).toMatchObject({ QB: 25, RB: 18, WR: 6 })
    // RB has 4 bench → deep_position; WR projection 6 vs baseline 10 → weak.
    expect(res.data?.strengthSignals).toContain("deep_position:RB")
    expect(res.data?.weaknessSignals).toContain("weak_position:WR")
    expect(res.data?.weaknessSignals).toContain("shallow_depth:WR")
    // Identity scoring (Sub-batch D): two elite + one deep + 1 weak + 1 shallow
    // → contender = 2*18 + 1*8 = 44 → above minConfidence (25).
    expect(res.data?.teamIdentityHint).toBe("contender")
    expect(res.data?.teamIdentityScores?.contender).toBeGreaterThanOrEqual(25)
  })

  it("(Batch 4 Sub-batch C) leaves projections null when WeeklyScore read fails", async () => {
    rosterFindFirstMock.mockResolvedValueOnce({
      id: "roster-self",
      playerData: {
        lineup_sections: {
          starters: [{ id: "p-qb", name: "QB1", position: "QB" }],
          bench: [],
          ir: [],
          taxi: [],
          devy: [],
        },
      },
    })
    weeklyScoreFindManyMock.mockRejectedValueOnce(new Error("weeklyScore down"))
    const provider = new RosterContextProvider()
    const res = await provider.load(
      baseRequest({ season: 2025, week: 5 })
    )
    expect(res.ok).toBe(true)
    // The projection map ends up empty → starterProjectedTotal stays null,
    // but byPosition still falls back to positional baselines.
    expect(res.data?.starterProjectedTotal).toBeNull()
    expect(res.data?.byPosition).toMatchObject({ QB: 17 })
  })
})
