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
  mockAdpDataFindFirst,
  mockAdpDataFindMany,
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
  mockAdpDataFindFirst: vi.fn(),
  mockAdpDataFindMany: vi.fn(),
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
    /*
     * ⚠ OMITTING THIS DELEGATE WOULD NOT FAIL — IT WOULD PASS, SILENTLY AND WRONGLY.
     * `resolveMarketAdp` goes through lib/adp/liveAdpFallback.ts, which wraps its reads in a
     * try/catch that degrades to an empty map. With no `adpDataRecord` on the mock, the call
     * throws a TypeError, the catch swallows it, `marketAdp` comes back null, and every
     * assertion below still passes while the new code path is never executed. That is the
     * same failure already recorded in this file for `@/lib/fantasycalc-db` — a stub applied
     * to the wrong place, failing as a missing VALUE rather than a missing function.
     */
    adpDataRecord: {
      findFirst: mockAdpDataFindFirst,
      findMany: mockAdpDataFindMany,
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
import { __resetLiveAdpFallbackCache } from "@/lib/adp/liveAdpFallback"

describe("PlayerStatsResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    /*
     * The live-ADP board is memoized at module scope for 15 minutes. Without this the first
     * test's board leaks into every later one and mock changes appear to have no effect.
     */
    __resetLiveAdpFallbackCache()
    mockAdpDataFindFirst.mockResolvedValue(null)
    mockAdpDataFindMany.mockResolvedValue([])
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

  /*
   * Market ADP — the path that exists because data/nfl-adp-multiplatform.csv is frozen at
   * 2026-03-08 and carries 4 of ~377 skill-position 2026 rookies, while adp_data carries them
   * from ffc. Jeremiyah Love (RB ARI) is a real example: ADP 31.7, provider_count 1, {ffc}.
   */
  describe("market ADP fallback", () => {
    const loveRow = {
      playerName: "Jeremiyah Love",
      position: "RB",
      team: "ARI",
      adp: 31.7,
      providerCount: 1,
      adpSpread: 0,
      providerBreakdown: { ffc: 31.7 },
    }

    function givenBoard(rows: unknown[], period = { season: 2026, week: 35 }) {
      mockAdpDataFindFirst.mockResolvedValue(period)
      mockAdpDataFindMany.mockResolvedValue(rows)
    }

    it("serves a rookie the static CSV never had, and PROVES the mock was reached", async () => {
      givenBoard([loveRow])
      const result = await resolvePlayerStats("Jeremiyah Love", { sport: "nfl" })

      expect(result?.marketAdp?.adp).toBe(31.7)
      expect(result?.sourceFlags.marketAdp).toBe(true)
      /*
       * The positive control. liveAdpFallback swallows its own errors, so without this a
       * missing adpDataRecord delegate would leave marketAdp null and every assertion above
       * would read as "no data" rather than "the test never ran the code".
       */
      expect(mockAdpDataFindMany).toHaveBeenCalledTimes(1)
    })

    it("carries provenance so one source cannot read as a consensus", async () => {
      givenBoard([loveRow])
      const result = await resolvePlayerStats("Jeremiyah Love", { sport: "nfl" })

      expect(result?.marketAdp?.providerCount).toBe(1)
      expect(result?.marketAdp?.providers).toEqual(["ffc"])
      // The basis is NOT the league's scoring, so it must be stated.
      expect(result?.marketAdp?.format).toBe("redraft")
      expect(result?.marketAdp?.scoring).toBe("standard")
      expect(result?.marketAdp?.season).toBe(2026)
      expect(result?.marketAdp?.week).toBe(35)
    })

    it("reports an unstated provider count as unknown rather than as 1", async () => {
      givenBoard([{ ...loveRow, providerCount: null, providerBreakdown: null }])
      const result = await resolvePlayerStats("Jeremiyah Love", { sport: "nfl" })

      expect(result?.marketAdp?.adp).toBe(31.7)
      expect(result?.marketAdp?.providerCount).toBeNull()
      expect(result?.marketAdp?.providers).toEqual([])
    })

    it("does NOT touch sleeperAdp or the sleeper source flag", async () => {
      givenBoard([loveRow])
      const result = await resolvePlayerStats("Jeremiyah Love", { sport: "nfl" })

      /*
       * The whole reason this is a separate field. `sourceFlags.sleeper` is rendered as
       * "Sleeper: yes/no" in the provenance panel and pushed to the model as the literal
       * token 'sleeper'; routing a consensus number through it would make both lie.
       */
      expect(result?.sleeperAdp).toBeNull()
      expect(result?.sourceFlags.sleeper).toBe(false)
    })

    it("fills position and team for a rookie with no history, from the ADP row", async () => {
      givenBoard([loveRow])
      const result = await resolvePlayerStats("Jeremiyah Love", { sport: "nfl" })

      expect(result?.position).toBe("RB")
      expect(result?.team).toBe("ARI")
    })

    it("never overrides a known position or team", async () => {
      // A veteran with real history must be unaffected by the new last-resort fallback.
      mockFindMany.mockResolvedValue([
        {
          season: "2025",
          gamesPlayed: 17,
          fantasyPoints: 300,
          fantasyPointsPerGame: 17.6,
          position: "WR",
          team: "CIN",
          stats: { receiving_yards: 1200, receptions: 90 },
        },
      ])
      givenBoard([{ ...loveRow, playerName: "Ja'Marr Chase", position: "RB", team: "ARI" }])
      const result = await resolvePlayerStats("Ja'Marr Chase", { sport: "nfl" })

      expect(result?.position).toBe("WR")
      expect(result?.team).toBe("CIN")
    })

    it("issues no query at all for a non-NFL sport", async () => {
      givenBoard([loveRow])
      const result = await resolvePlayerStats("Some Skater", { sport: "nhl" })

      expect(result?.marketAdp).toBeNull()
      expect(result?.sourceFlags.marketAdp).toBe(false)
      expect(mockAdpDataFindMany).not.toHaveBeenCalled()
    })

    it("degrades to null when the board is unreadable, without failing the resolve", async () => {
      mockAdpDataFindFirst.mockRejectedValue(new Error("connection refused"))
      const result = await resolvePlayerStats("Jeremiyah Love", { sport: "nfl" })

      expect(result).not.toBeNull()
      expect(result?.marketAdp).toBeNull()
      expect(result?.sourceFlags.marketAdp).toBe(false)
    })

    it("loads the board ONCE for concurrent resolves, not once per player", async () => {
      givenBoard([loveRow, { ...loveRow, playerName: "Carnell Tate", position: "WR", team: "TEN" }])

      await Promise.all([
        resolvePlayerStats("Jeremiyah Love", { sport: "nfl" }),
        resolvePlayerStats("Carnell Tate", { sport: "nfl" }),
        resolvePlayerStats("Jeremiyah Love", { sport: "nfl" }),
      ])

      /*
       * The comparison lab resolves up to 6 players through Promise.all and the agent
       * pipeline fans out unbounded. A TTL cache alone does not help: it is written only
       * after the awaits, so without in-flight promise sharing all N callers miss together
       * and each materialises the whole consensus board.
       */
      expect(mockAdpDataFindMany).toHaveBeenCalledTimes(1)
    })
  })
})
