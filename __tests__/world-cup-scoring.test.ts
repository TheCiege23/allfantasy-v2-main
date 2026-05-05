import { describe, expect, it } from "vitest"
import { normalizeWorldCupFixture } from "@/lib/world-cup/apiSportsWorldCup"
import { DEFAULT_WORLD_CUP_SCORING } from "@/lib/world-cup/worldCupBracketBuilder"
import { buildWorldCupLeaderboardRows, evaluateWorldCupPick, isChampionStillAlive } from "@/lib/world-cup/worldCupScoringService"

describe("World Cup scoring", () => {
  it("awards round points for correct final results", () => {
    const result = evaluateWorldCupPick(
      {
        id: "m1",
        round: "quarterfinal",
        status: "final",
        homeTeamId: "arg",
        awayTeamId: "bra",
        homeTeamName: "Argentina",
        awayTeamName: "Brazil",
        winnerTeamId: "arg",
      },
      { selectedTeamId: "arg", selectedTeamName: "Argentina" },
      DEFAULT_WORLD_CUP_SCORING
    )
    expect(result).toEqual({ pointsAwarded: 4, isCorrect: true })
  })

  it("uses penalty winner data from API-Football payloads", () => {
    const normalized = normalizeWorldCupFixture({
      fixture: { id: 10, date: "2026-07-19T20:00:00Z", status: { short: "PEN" } },
      league: { round: "Final" },
      teams: {
        home: { id: 1, name: "France", winner: false },
        away: { id: 2, name: "Spain", winner: false },
      },
      goals: { home: 1, away: 1 },
      score: { penalty: { home: 4, away: 5 } },
    })
    expect(normalized?.status).toBe("final")
    expect(normalized?.winnerApiTeamId).toBe(2)
  })

  it("preserves correct picks when a placeholder resolves via slot key", () => {
    const result = evaluateWorldCupPick(
      {
        round: "round_of_32",
        selectedTeamId: null,
        selectedTeamName: "Group A Winner",
        selectedSlotKey: "A1",
      },
      {
        id: "m1",
        round: "round_of_32",
        homeSlotKey: "A1",
        awaySlotKey: "B2",
        homeTeamId: "arg",
        awayTeamId: "ned",
        homeTeamName: "Argentina",
        awayTeamName: "Netherlands",
        status: "final",
        winnerTeamId: "arg",
        winnerTeamName: "Argentina",
      },
      DEFAULT_WORLD_CUP_SCORING
    )

    expect(result).toEqual({ isCorrect: true, pointsAwarded: 1 })
  })

  it("sorts leaderboard by score, champion alive, then joined date", () => {
    const rows = buildWorldCupLeaderboardRows({
      participants: [
        { id: "p1", userId: "u1", displayName: "A", joinedAt: new Date("2026-01-02"), maxPossibleScore: 40, championPickTeamId: "arg" },
        { id: "p2", userId: "u2", displayName: "B", joinedAt: new Date("2026-01-01"), maxPossibleScore: 40, championPickTeamId: "bra" },
      ],
      picks: [
        { participantId: "p1", pointsAwarded: 4, isCorrect: true },
        { participantId: "p2", pointsAwarded: 4, isCorrect: true },
      ],
      matches: [{ status: "final", homeTeamId: "arg", awayTeamId: "bra", winnerTeamId: "arg" }],
    })
    expect(rows[0].id).toBe("p1")
    expect(rows[0].rank).toBe(1)
  })

  it("detects when a champion pick has been eliminated", () => {
    expect(
      isChampionStillAlive({
        championPickTeamId: "bra",
        matches: [{ status: "final", homeTeamId: "arg", awayTeamId: "bra", winnerTeamId: "arg" }],
      })
    ).toBe(false)
  })
})
