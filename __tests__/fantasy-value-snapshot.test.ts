import { describe, expect, it } from "vitest"
import { buildFantasyValueSnapshot } from "@/lib/sports-reporting/FantasyValueSnapshotService"

describe("FantasyValueSnapshot contract", () => {
  it("builds a grounded snapshot from cached player value, stats, injury, and news data", () => {
    const snapshot = buildFantasyValueSnapshot({
      sport: "NFL",
      playerId: "p-1",
      playerName: "Player One",
      position: "RB",
      team: "DAL",
      leagueFormat: "dynasty",
      scoringFormat: "ppr",
      adp: 24,
      dynastyValue: 88,
      injuryStatus: "healthy",
      projections: { projectedFppg: 14.2 },
      seasonStats: {
        fantasyPoints: 220,
        fantasyPointsPerGame: 13.8,
        gamesPlayed: 16,
        fetchedAt: new Date(),
        source: "rolling_insights",
      },
      news: [{ title: "Role stable", source: "newsapi", publishedAt: new Date() }],
      lastUpdated: new Date(),
      source: "sports_players",
    })

    expect(snapshot).toMatchObject({
      sport: "NFL",
      playerId: "p-1",
      playerName: "Player One",
      position: "RB",
      team: "DAL",
      leagueFormat: "dynasty",
      scoringFormat: "ppr",
      shortTermValue: 99,
      longTermValue: 88,
      injuryRisk: "low",
    })
    expect(snapshot.sourcesUsed).toEqual(expect.arrayContaining(["rolling_insights", "newsapi", "sports_players"]))
    expect(snapshot.missingData).toEqual([])
    expect(snapshot.confidence).toBeGreaterThanOrEqual(0.85)
  })

  it("returns a partial snapshot with missingData instead of fake values", () => {
    const snapshot = buildFantasyValueSnapshot({
      sport: "MLB",
      playerName: "Unknown Hitter",
      leagueFormat: "redraft",
      scoringFormat: "standard",
    })

    expect(snapshot.shortTermValue).toBeNull()
    expect(snapshot.longTermValue).toBeNull()
    expect(snapshot.injuryRisk).toBe("unknown")
    expect(snapshot.missingData).toEqual(
      expect.arrayContaining([
        "provider player id",
        "team",
        "position",
        "short-term projection/stat value",
        "long-term/dynasty value",
        "injury status",
        "recent news",
      ])
    )
    expect(snapshot.confidence).toBeLessThan(0.4)
  })

  it("uses ADP only as a fallback and keeps injury risk explicit", () => {
    const snapshot = buildFantasyValueSnapshot({
      sport: "NBA",
      playerId: "nba-1",
      playerName: "Player Two",
      position: "G",
      team: "NYK",
      leagueFormat: "redraft",
      scoringFormat: "points",
      adp: 60,
      injuryStatus: "questionable",
      lastUpdated: new Date(),
      source: "sports_player_record",
    })

    expect(snapshot.shortTermValue).toBe(80)
    expect(snapshot.longTermValue).toBe(80)
    expect(snapshot.injuryRisk).toBe("medium")
    expect(snapshot.riskScore).toBe(55)
    expect(snapshot.missingData).toContain("recent news")
  })
})
