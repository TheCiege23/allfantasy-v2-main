import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  mockFindMany,
  mockGetPlayerValuesForNames,
  mockAiAdpFindMany,
  mockCareerProjectionFindFirst,
  mockSportsInjuryFindMany,
  mockIdentityFindMany,
  mockSportsPlayerFindFirst,
  mockSportsGameFindMany,
  mockTeamSeasonStatsFindMany,
} = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockGetPlayerValuesForNames: vi.fn(),
  mockAiAdpFindMany: vi.fn(),
  mockCareerProjectionFindFirst: vi.fn(),
  mockSportsInjuryFindMany: vi.fn(),
  mockIdentityFindMany: vi.fn(),
  mockSportsPlayerFindFirst: vi.fn(),
  mockSportsGameFindMany: vi.fn(),
  mockTeamSeasonStatsFindMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    playerSeasonStats: {
      findMany: mockFindMany,
      findFirst: vi.fn(),
    },
    aiAdpSnapshot: {
      findMany: mockAiAdpFindMany,
    },
    playerCareerProjection: {
      findFirst: mockCareerProjectionFindFirst,
    },
    sportsInjury: {
      findMany: mockSportsInjuryFindMany,
    },
    playerIdentityMap: {
      findMany: mockIdentityFindMany,
    },
    sportsPlayer: {
      findFirst: mockSportsPlayerFindFirst,
    },
    sportsGame: {
      findMany: mockSportsGameFindMany,
    },
    teamSeasonStats: {
      findMany: mockTeamSeasonStatsFindMany,
    },
  },
}))

/*
 * ⚠ THIS MOCKED THE WRONG MODULE, so the real one ran and every projection came
 * back null. The resolver moved to the DB-FIRST reader —
 * `getPlayerValuesForNamesDbFirst` from `@/lib/fantasycalc-db` — while this file
 * kept stubbing `getPlayerValuesForNames` on `@/lib/fantasycalc`. Nothing
 * errored: the stub simply applied to a module the resolver only takes a TYPE
 * from, which is why it failed as a missing value rather than a missing
 * function.
 */
vi.mock("@/lib/fantasycalc-db", () => ({
  getPlayerValuesForNamesDbFirst: mockGetPlayerValuesForNames,
}))

import { resolvePlayerStats } from "@/lib/player-comparison-lab/PlayerStatsResolver"

describe("PlayerStatsResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiAdpFindMany.mockResolvedValue([])
    mockCareerProjectionFindFirst.mockResolvedValue(null)
    mockSportsInjuryFindMany.mockResolvedValue([])
    mockIdentityFindMany.mockResolvedValue([])
    mockSportsPlayerFindFirst.mockResolvedValue(null)
    mockSportsGameFindMany.mockResolvedValue([])
    mockTeamSeasonStatsFindMany.mockResolvedValue([])
  })

  it("resolves historical and projection data with sport normalization", async () => {
    mockFindMany.mockResolvedValue([
      {
        season: "2024",
        gamesPlayed: 17,
        fantasyPoints: 401.2,
        fantasyPointsPerGame: null,
        stats: { passing_yards: 4550, rushing_yards: 480, receiving_yards: null, receptions: null },
      },
      {
        season: "2023",
        gamesPlayed: 16,
        fantasyPoints: 360,
        fantasyPointsPerGame: 22.5,
        stats: { passingYards: 4300, rushingYards: 420, receivingYards: null, receptions: null },
      },
    ])

    const map = new Map<string, any>()
    map.set("josh allen", {
      value: 9100,
      rank: 6,
      positionRank: 3,
      trend30Day: 150,
      redraftValue: 350,
      position: "QB",
      team: "BUF",
      volatility: 14,
    })
    mockGetPlayerValuesForNames.mockResolvedValue(map)

    const result = await resolvePlayerStats("Josh Allen", {
      sport: "soccer",
      scoringFormat: "half_ppr",
    })

    expect(result).not.toBeNull()
    expect(result?.name).toBe("Josh Allen")
    expect(result?.projection?.value).toBe(9100)
    expect(result?.projection?.team).toBe("BUF")
    expect(result?.historical).toHaveLength(2)
    expect(result?.historical[0]?.season).toBe("2024")
    expect(result?.historical[0]?.fantasyPointsPerGame).toBeCloseTo(401.2 / 17, 4)
    expect(result?.historical[0]?.passingYards).toBe(4550)
    expect(result?.historical[1]?.passingYards).toBe(4300)

    expect(mockFindMany).toHaveBeenCalledTimes(1)
    expect(mockFindMany.mock.calls[0]?.[0]?.where?.sport).toBe("SOCCER")
    expect(mockGetPlayerValuesForNames).toHaveBeenCalledWith(
      ["Josh Allen"],
      expect.objectContaining({ ppr: 0.5 })
    )
  })

  /**
   * Regression: PlayerIdentityMap holds 178 duplicate-name groups in NFL, and the
   * twins split the provider ids. The old `findFirst` had no `orderBy`, so landing
   * on the id-less twin reported an available player as unavailable. The row that
   * actually carries the sleeperId is deliberately placed SECOND here — a resolver
   * that only looks at the first candidate fails this test.
   */
  it("reports sleeper availability from the populated twin when a name is duplicated", async () => {
    mockIdentityFindMany.mockResolvedValue([
      {
        id: "id-a",
        canonicalName: "Tony Adams",
        normalizedName: "tony adams",
        position: "DB",
        currentTeam: "TEN",
        sport: "NFL",
        sleeperId: null,
        espnId: null,
        mflId: null,
        fleaflickerId: null,
      },
      {
        id: "id-b",
        canonicalName: "Tony Adams",
        normalizedName: "tony adams",
        position: "DB",
        currentTeam: "TEN",
        sport: "NFL",
        sleeperId: "8860",
        espnId: null,
        mflId: null,
        fleaflickerId: null,
      },
    ])

    const result = await resolvePlayerStats("Tony Adams", { sport: "nfl" })

    expect(result?.sourceFlags.sleeper).toBe(true)
    // All candidates must be considered, and in a stable order.
    expect(mockIdentityFindMany).toHaveBeenCalledTimes(1)
    expect(mockIdentityFindMany.mock.calls[0]?.[0]?.orderBy).toEqual({ id: "asc" })
    // The id-less twin must not have short-circuited into the SportsPlayer fallback.
    expect(mockSportsPlayerFindFirst).not.toHaveBeenCalled()
  })

  it("returns null for empty input", async () => {
    const result = await resolvePlayerStats("   ")
    expect(result).toBeNull()
    expect(mockFindMany).not.toHaveBeenCalled()
    expect(mockGetPlayerValuesForNames).not.toHaveBeenCalled()
  })
})
