/**
 * worldCupChimmyContext — DB context builder unit tests
 *
 * Verifies that buildWorldCupChimmyContext correctly assembles context
 * from mocked DB rows (Prisma).  No real DB or external calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Hoisted Prisma table mocks ───────────────────────────────────────────────

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())
const mockFindMany = vi.hoisted(() => vi.fn())

vi.mock("server-only", () => ({}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worldCupBracketChallenge: { findUnique: mockFindUnique },
    worldCupBracketEntry: { findFirst: mockFindFirst },
    worldCupBracketMatch: { findMany: mockFindMany },
  },
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildWorldCupChimmyContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue(null)
    mockFindFirst.mockResolvedValue(null)
    mockFindMany.mockResolvedValue([])
  })

  it("returns empty context (liveDataStatus=unavailable, entry=null) when challenge row missing", async () => {
    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "missing", userId: "u1" })

    expect(ctx.challengeId).toBe("missing")
    expect(ctx.entry).toBeNull()
    expect(ctx.liveMatches).toEqual([])
    expect(ctx.upcomingMatches).toEqual([])
    expect(ctx.recentMatches).toEqual([])
    expect(ctx.liveDataStatus).toBe("unavailable")
    expect(ctx.poolName).toBeTruthy()
  })

  it("includes scoring values from the challenge scoring profile", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Office Cup", status: "open", pickLockAt: null,
      _count: { participants: 5 },
      scoringProfile: {
        roundOf32Points: 10, roundOf16Points: 20, quarterFinalPoints: 40,
        semiFinalPoints: 80, finalPoints: 160, championBonusPoints: 320, thirdPlacePoints: 4,
      },
    })

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    expect(ctx.scoring).toMatchObject({
      roundOf32Points: 10, roundOf16Points: 20, quarterFinalPoints: 40,
      semiFinalPoints: 80, finalPoints: 160, championBonusPoints: 320, thirdPlacePoints: 4,
    })
    expect(ctx.participantCount).toBe(5)
    expect(ctx.poolName).toBe("Office Cup")
  })

  it("uses DEFAULT_WORLD_CUP_SCORING when scoringProfile is null", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Default Pool", status: "open", pickLockAt: null,
      _count: { participants: 2 }, scoringProfile: null,
    })

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    // Defaults from worldCupBracketBuilder
    expect(ctx.scoring.roundOf32Points).toBe(10)
    expect(ctx.scoring.finalPoints).toBe(160)
    expect(ctx.scoring.championBonusPoints).toBe(320)
  })

  it("marks challenge as locked when pickLockAt is in the past", async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Locked Pool", status: "open", pickLockAt: past,
      _count: { participants: 1 }, scoringProfile: null,
    })

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    expect(ctx.isLocked).toBe(true)
  })

  it("marks challenge as unlocked when pickLockAt is in the future", async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Open Pool", status: "open", pickLockAt: future,
      _count: { participants: 1 }, scoringProfile: null,
    })

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    expect(ctx.isLocked).toBe(false)
  })

  it("includes user group picks and knockout picks from DB entry", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Cup", status: "open", pickLockAt: null,
      _count: { participants: 3 }, scoringProfile: null,
    })
    mockFindFirst.mockResolvedValue({
      id: "entry-1", name: "My Entry", championTeamName: "Brazil",
      totalScore: 120, maxPossibleScore: 500, rank: 2,
      correctPicks: 5, incorrectPicks: 1, isComplete: false, isLocked: false,
      groupRankingPicks: [
        {
          predictedRank: 1, isCorrect: true, pointsAwarded: 10,
          group: { groupKey: "A", displayName: "Group A" },
          team: { name: "Brazil" },
        },
        {
          predictedRank: 2, isCorrect: false, pointsAwarded: 0,
          group: { groupKey: "A", displayName: "Group A" },
          team: { name: "Argentina" },
        },
      ],
      picks: [
        {
          round: "ROUND_OF_16", selectedTeamName: "Brazil", isCorrect: null, pointsAwarded: 0,
          match: { homeTeamName: "Brazil", awayTeamName: "Mexico" },
        },
      ],
    })

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    expect(ctx.entry).not.toBeNull()
    expect(ctx.entry!.championPick).toBe("Brazil")
    expect(ctx.entry!.totalScore).toBe(120)
    expect(ctx.entry!.rank).toBe(2)

    expect(ctx.entry!.groupPicks).toHaveLength(2)
    expect(ctx.entry!.groupPicks[0]).toMatchObject({
      rank: 1, teamName: "Brazil", groupKey: "A",
      groupName: "Group A", isCorrect: true, pointsAwarded: 10,
    })
    expect(ctx.entry!.groupPicks[1]).toMatchObject({
      rank: 2, teamName: "Argentina", isCorrect: false, pointsAwarded: 0,
    })

    expect(ctx.entry!.knockoutPicks).toHaveLength(1)
    expect(ctx.entry!.knockoutPicks[0]).toMatchObject({
      round: "ROUND_OF_16", homeTeamName: "Brazil", awayTeamName: "Mexico",
      pickedTeam: "Brazil", isCorrect: null, pointsAwarded: 0,
    })
  })

  it("includes live match data with score, minute, and lastSyncedAt", async () => {
    const syncedAt = new Date("2026-06-15T18:30:00Z")
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Pool", status: "open", pickLockAt: null,
      _count: { participants: 1 }, scoringProfile: null,
    })
    mockFindMany.mockResolvedValue([
      {
        id: "m1", round: "SEMI_FINAL",
        homeTeamName: "France", awayTeamName: "England",
        homeScore: 1, awayScore: 0, homePenaltyScore: null, awayPenaltyScore: null,
        winnerTeamName: null, status: "live",
        elapsedMinute: 67, injuryTime: 2,
        startsAt: new Date("2026-06-15T17:00:00Z"),
        venueName: "Stade de France", venueCity: "Paris",
        apiStatusShort: "2H", lastScoreSyncedAt: syncedAt,
      },
    ])

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    expect(ctx.liveMatches).toHaveLength(1)
    const m = ctx.liveMatches[0]
    expect(m.homeTeamName).toBe("France")
    expect(m.awayTeamName).toBe("England")
    expect(m.homeScore).toBe(1)
    expect(m.awayScore).toBe(0)
    expect(m.minute).toBe(67)
    expect(m.injuryTime).toBe(2)
    expect(m.venueName).toBe("Stade de France")
    expect(m.lastSyncedAt).toBe(syncedAt.toISOString())
    expect(ctx.liveDataStatus).toBe("live")
    expect(ctx.lastSyncedAt).toBe(syncedAt.toISOString())
  })

  it("reports fixture_only liveDataStatus when matches are scheduled but none live", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Pool", status: "open", pickLockAt: null,
      _count: { participants: 1 }, scoringProfile: null,
    })
    const futureKickOff = new Date(Date.now() + 6 * 60 * 60 * 1000)
    mockFindMany.mockResolvedValue([
      {
        id: "m2", round: "QF",
        homeTeamName: "Spain", awayTeamName: "Portugal",
        homeScore: null, awayScore: null, homePenaltyScore: null, awayPenaltyScore: null,
        winnerTeamName: null, status: "scheduled",
        elapsedMinute: null, injuryTime: null,
        startsAt: futureKickOff,
        venueName: null, venueCity: null, apiStatusShort: null, lastScoreSyncedAt: null,
      },
    ])

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    expect(ctx.liveMatches).toHaveLength(0)
    expect(ctx.upcomingMatches).toHaveLength(1)
    expect(ctx.liveDataStatus).toBe("fixture_only")
    expect(ctx.lastSyncedAt).toBeNull()
  })

  it("reports liveDataStatus=unavailable when no matches at all", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Pool", status: "open", pickLockAt: null,
      _count: { participants: 1 }, scoringProfile: null,
    })
    mockFindMany.mockResolvedValue([])

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    expect(ctx.liveDataStatus).toBe("unavailable")
    expect(ctx.liveMatches).toHaveLength(0)
    expect(ctx.upcomingMatches).toHaveLength(0)
  })

  it("returns null entry when no DB entry exists for the user", async () => {
    mockFindUnique.mockResolvedValue({
      id: "c1", name: "Pool", status: "open", pickLockAt: null,
      _count: { participants: 1 }, scoringProfile: null,
    })
    mockFindFirst.mockResolvedValue(null)

    const { buildWorldCupChimmyContext } = await import("@/lib/world-cup/worldCupChimmyContext")
    const ctx = await buildWorldCupChimmyContext({ challengeId: "c1", userId: "u1" })

    expect(ctx.entry).toBeNull()
  })
})
