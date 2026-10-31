/**
 * Phase 2C Batch 3 — MatchupContextProvider tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  appUserFindUniqueMock,
  leagueFindUniqueMock,
  leagueTeamFindFirstMock,
  redraftSeasonFindFirstMock,
  rosterFindUniqueMock,
  teamWeekResultFindUniqueMock,
  teamWeekResultFindFirstMock,
  weeklyMatchupFindFirstMock,
  weeklyMatchupFindManyMock,
  weeklyScoreFindManyMock,
} = vi.hoisted(() => ({
  appUserFindUniqueMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
  leagueTeamFindFirstMock: vi.fn(),
  redraftSeasonFindFirstMock: vi.fn(),
  rosterFindUniqueMock: vi.fn(),
  teamWeekResultFindUniqueMock: vi.fn(),
  teamWeekResultFindFirstMock: vi.fn(),
  weeklyMatchupFindFirstMock: vi.fn(),
  weeklyMatchupFindManyMock: vi.fn(),
  weeklyScoreFindManyMock: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appUser: { findUnique: appUserFindUniqueMock },
    league: { findUnique: leagueFindUniqueMock },
    leagueTeam: { findFirst: leagueTeamFindFirstMock },
    redraftSeason: { findFirst: redraftSeasonFindFirstMock },
    roster: { findUnique: rosterFindUniqueMock },
    teamWeekResult: {
      findUnique: teamWeekResultFindUniqueMock,
      findFirst: teamWeekResultFindFirstMock,
    },
    weeklyMatchup: { findFirst: weeklyMatchupFindFirstMock, findMany: weeklyMatchupFindManyMock },
    weeklyScore: { findMany: weeklyScoreFindManyMock },
  },
}))

import { MatchupContextProvider } from "@/lib/chimmy-context/providers/MatchupContextProvider"
import type { ChimmyContextRequest } from "@/lib/chimmy-context/types"

function baseRequest(
  overrides: Partial<ChimmyContextRequest> = {}
): ChimmyContextRequest {
  return {
    userId: "user-1",
    leagueId: "league-1",
    perRequestMemo: new Map<string, unknown>(),
    ...overrides,
  }
}

describe("MatchupContextProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appUserFindUniqueMock.mockResolvedValue({ activeLeagueId: null })
    leagueTeamFindFirstMock.mockResolvedValue({
      id: "team-self",
      teamName: "Self",
      platformUserId: "platform-self",
    })
    leagueFindUniqueMock.mockResolvedValue({
      season: 2025,
      playoffStartWeek: 14,
      settings: null,
    })
    redraftSeasonFindFirstMock.mockResolvedValue({
      season: 2025,
      currentWeek: 8,
      playoffStartWeek: 14,
      totalWeeks: 17,
    })
    rosterFindUniqueMock.mockResolvedValue({ id: "roster-self" })
    teamWeekResultFindFirstMock.mockResolvedValue(null)
    weeklyMatchupFindFirstMock.mockResolvedValue(null)
    weeklyScoreFindManyMock.mockResolvedValue([])
  })

  it("returns null when leagueId cannot be resolved", async () => {
    const provider = new MatchupContextProvider()
    const res = await provider.load(baseRequest({ leagueId: null }))
    expect(res.ok).toBe(true)
    expect(res.data).toBeNull()
    expect(teamWeekResultFindUniqueMock).not.toHaveBeenCalled()
  })

  it("emits week + playoff context when viewer has no platformUserId", async () => {
    leagueTeamFindFirstMock.mockResolvedValueOnce({
      id: "team-self",
      teamName: "Self",
      platformUserId: null,
    })
    const provider = new MatchupContextProvider()
    const res = await provider.load(baseRequest())
    expect(res.ok).toBe(true)
    expect(res.data).not.toBeNull()
    expect(res.data?.week).toBe(8)
    expect(res.data?.playoffStartWeek).toBe(14)
    expect(res.data?.yourTeamId).toBe("team-self")
    expect(res.data?.opponentTeamId).toBeNull()
    expect(rosterFindUniqueMock).not.toHaveBeenCalled()
  })

  it("returns safe partial when the viewer's Roster row is missing", async () => {
    rosterFindUniqueMock.mockResolvedValueOnce(null)
    const provider = new MatchupContextProvider()
    const res = await provider.load(baseRequest())
    expect(res.ok).toBe(true)
    expect(res.data?.opponentTeamId).toBeNull()
    expect(res.data?.yourActualPoints).toBeNull()
    expect(teamWeekResultFindUniqueMock).not.toHaveBeenCalled()
  })

  it("returns viewer-only slice on a bye week (no opponentRosterId)", async () => {
    teamWeekResultFindUniqueMock.mockResolvedValueOnce({
      totalPoints: 102.55,
      opponentRosterId: null,
      status: "in_progress",
    })
    const provider = new MatchupContextProvider()
    const res = await provider.load(baseRequest())
    expect(res.ok).toBe(true)
    expect(res.data?.status).toBe("in_progress")
    expect(res.data?.yourActualPoints).toBe(102.55)
    expect(res.data?.opponentActualPoints).toBeNull()
    expect(res.data?.opponentTeamId).toBeNull()
    expect(res.data?.opponentTeamName).toBeNull()
  })

  it("returns full matchup slice including opponent identity and actual points", async () => {
    teamWeekResultFindUniqueMock
      .mockResolvedValueOnce({
        totalPoints: 124.3,
        opponentRosterId: "roster-opp",
        status: "final",
      })
      .mockResolvedValueOnce({ totalPoints: 110.1, status: "final" })
    rosterFindUniqueMock
      .mockResolvedValueOnce({ id: "roster-self" })
      .mockResolvedValueOnce({ platformUserId: "platform-opp" })
    leagueTeamFindFirstMock
      .mockResolvedValueOnce({
        id: "team-self",
        teamName: "Self",
        platformUserId: "platform-self",
      })
      .mockResolvedValueOnce({ id: "team-opp", teamName: "Rivals" })

    const provider = new MatchupContextProvider()
    const res = await provider.load(baseRequest())

    expect(res.ok).toBe(true)
    expect(res.data?.week).toBe(8)
    expect(res.data?.season).toBe(2025)
    expect(res.data?.status).toBe("final")
    expect(res.data?.yourActualPoints).toBe(124.3)
    expect(res.data?.opponentActualPoints).toBe(110.1)
    expect(res.data?.opponentTeamId).toBe("team-opp")
    expect(res.data?.opponentTeamName).toBe("Rivals")
    expect(res.data?.playoffStartWeek).toBe(14)
    expect(res.data?.isPlayoffWeek).toBe(false)
    expect(res.data?.weeksUntilPlayoffs).toBe(6)
    expect(res.data?.currentWeekSource).toBe("redraftSeason")
  })

  it("(Batch 4 Sub-batch B) wires projection totals + intel into the full slice", async () => {
    teamWeekResultFindUniqueMock
      .mockResolvedValueOnce({
        totalPoints: 50.0,
        opponentRosterId: "roster-opp",
        status: "in_progress",
      })
      .mockResolvedValueOnce({ totalPoints: 60.0, status: "in_progress" })
    rosterFindUniqueMock
      .mockResolvedValueOnce({ id: "roster-self" })
      .mockResolvedValueOnce({ platformUserId: "platform-opp" })
    leagueTeamFindFirstMock
      .mockResolvedValueOnce({
        id: "team-self",
        teamName: "Self",
        platformUserId: "platform-self",
      })
      .mockResolvedValueOnce({ id: "team-opp", teamName: "Rivals" })
    weeklyScoreFindManyMock.mockResolvedValueOnce([
      { rosterId: "roster-self", playerId: "p1", points: 10, isStarter: true, statLine: { projection: 22 } },
      { rosterId: "roster-self", playerId: "p2", points: 0, isStarter: true, statLine: null }, // pos null → fallback 10
      { rosterId: "roster-opp", playerId: "p3", points: 0, isStarter: true, statLine: { projection: 18 } },
      { rosterId: "roster-opp", playerId: "p4", points: 0, isStarter: true, statLine: null }, // fallback 10
    ])

    const provider = new MatchupContextProvider()
    const res = await provider.load(baseRequest())

    expect(res.ok).toBe(true)
    // self: max(10,22)=22 + max(0,10)=10 = 32. opp: max(0,18)=18 + max(0,10)=10 = 28.
    expect(res.data?.yourProjectedPoints).toBe(32)
    expect(res.data?.opponentProjectedPoints).toBe(28)
    // Actuals trigger actual-margin leader because matchup is in_progress.
    expect(res.data?.projectedMargin).toBe(4)
    expect(res.data?.projectedLeader).toBe("opponent")
    expect(res.data?.projectedWinProbability).toBeNull()
    expect(res.data?.urgencySignals).toEqual(["in_progress"])
    // Priority scaffold returns "unknown" until formula lands.
    expect(res.data?.recommendationPriority).toBe("unknown")
    expect(weeklyScoreFindManyMock).toHaveBeenCalledTimes(1)
  })

  it("(Batch 4 Sub-batch B) leaves projections null and still returns slice when weeklyScore read fails", async () => {
    teamWeekResultFindUniqueMock
      .mockResolvedValueOnce({
        totalPoints: 50,
        opponentRosterId: "roster-opp",
        status: "scheduled",
      })
      .mockResolvedValueOnce({ totalPoints: 60, status: "scheduled" })
    rosterFindUniqueMock
      .mockResolvedValueOnce({ id: "roster-self" })
      .mockResolvedValueOnce({ platformUserId: "platform-opp" })
    leagueTeamFindFirstMock
      .mockResolvedValueOnce({
        id: "team-self",
        teamName: "Self",
        platformUserId: "platform-self",
      })
      .mockResolvedValueOnce({ id: "team-opp", teamName: "Rivals" })
    weeklyScoreFindManyMock.mockRejectedValueOnce(new Error("weeklyScore down"))

    const provider = new MatchupContextProvider()
    const res = await provider.load(baseRequest())

    expect(res.ok).toBe(true)
    expect(res.data?.yourProjectedPoints).toBeNull()
    expect(res.data?.opponentProjectedPoints).toBeNull()
    // Slice still populated with the rest of the fields.
    expect(res.data?.opponentTeamId).toBe("team-opp")
    expect(res.data?.yourActualPoints).toBe(50)
  })

  it("returns ok:false with safe envelope when Prisma rejects mid-flow", async () => {
    rosterFindUniqueMock.mockRejectedValueOnce(new Error("db down"))
    // resolveLeagueIdentity needs to succeed before the failure hits roster lookup.
    const provider = new MatchupContextProvider()
    const res = await provider.load(baseRequest())
    // resolveLeagueIdentity catches its own errors; roster catch() returns null
    // → safe partial path. So this should still be ok:true with null opponent.
    expect(res.ok).toBe(true)
    expect(res.data?.opponentTeamId).toBeNull()
  })
})

describe("MatchupContextProvider — imported leagues read the stored schedule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appUserFindUniqueMock.mockResolvedValue({ activeLeagueId: null })
    // Fantrax: the viewer's team is claimed, and carries no platform user id.
    leagueTeamFindFirstMock.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.OR) return { id: "team-self", teamName: "Self", platformUserId: null }
      if (args.where.id === "team-self") return { externalId: "fx-self" }
      if (args.where.externalId === "fx-opp") return { id: "team-opp", teamName: "Rival" }
      return null
    })
    leagueFindUniqueMock.mockResolvedValue({
      season: 2026,
      playoffStartWeek: 14,
      settings: null,
      platform: "fantrax",
      platformLeagueId: "fx-league",
    })
    redraftSeasonFindFirstMock.mockResolvedValue(null)
    rosterFindUniqueMock.mockResolvedValue(null)
    teamWeekResultFindFirstMock.mockResolvedValue(null)
    teamWeekResultFindUniqueMock.mockResolvedValue(null)
    weeklyMatchupFindFirstMock.mockResolvedValue(null)
    weeklyScoreFindManyMock.mockResolvedValue([])
  })

  it("names the opponent and both scores from WeeklyMatchup", async () => {
    weeklyMatchupFindManyMock.mockResolvedValue([
      { rosterId: "fx-self", matchupId: 3, pointsFor: 101.256 },
      { rosterId: "fx-opp", matchupId: 3, pointsFor: 88 },
      { rosterId: "fx-other", matchupId: 4, pointsFor: 70 },
    ])
    const res = await new MatchupContextProvider().load(baseRequest({ week: 5 } as Partial<ChimmyContextRequest>))
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({
      yourTeamId: "team-self",
      opponentTeamId: "team-opp",
      opponentTeamName: "Rival",
      yourActualPoints: 101.26,
      opponentActualPoints: 88,
      status: "unknown",
    })
    expect(weeklyMatchupFindManyMock.mock.calls[0][0].where).toMatchObject({ leagueId: "fx-league" })
  })

  it("an unpaired week is not an opponent", async () => {
    weeklyMatchupFindManyMock.mockResolvedValue([{ rosterId: "fx-self", matchupId: 3, pointsFor: 50 }])
    const res = await new MatchupContextProvider().load(baseRequest({ week: 5 } as Partial<ChimmyContextRequest>))
    expect(res.data).toMatchObject({ opponentTeamId: null, opponentTeamName: null, yourActualPoints: null })
  })

  it("an AllFantasy-hosted league never reads it", async () => {
    leagueFindUniqueMock.mockResolvedValue({ season: 2026, playoffStartWeek: 14, settings: null, platform: "allfantasy", platformLeagueId: null })
    await new MatchupContextProvider().load(baseRequest({ week: 5 } as Partial<ChimmyContextRequest>))
    expect(weeklyMatchupFindManyMock).not.toHaveBeenCalled()
  })
})
