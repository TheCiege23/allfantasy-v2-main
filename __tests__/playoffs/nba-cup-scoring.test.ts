import { describe, expect, it } from "vitest"
import { getPlayoffPickResult, roundPointsTable, scorePlayoffEntryPicks } from "@/lib/playoffs/playoffScoring"
import { scoreAndPotential } from "@/lib/playoffs/playoffCompetition"
import { eligibleNbaCupPicks } from "@/lib/playoffs/nbaCupTournament"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"

const game = (id: string, round: PlayoffSeriesView["round"], winnerTeamName: string | null = null) => ({
  id, round, homeTeamName: "Boston Celtics", awayTeamName: "Charlotte Hornets", winnerTeamName,
  seriesSummary: null, liveHomeScore: null, liveAwayScore: null,
})

describe("NBA Cup group-play winner points", () => {
  it("awards exactly one point per correct group-game winner alongside knockout points", () => {
    const games = [
      game("group-1", "cup_group_play", "Boston Celtics"),
      game("group-2", "cup_group_play", "Charlotte Hornets"),
      game("quarter", "cup_quarterfinals", "Boston Celtics"),
      game("semi", "cup_semifinals", "Boston Celtics"),
      game("final", "cup_championship", "Boston Celtics"),
    ]
    expect(scorePlayoffEntryPicks(games, games.map((row) => ({ seriesId: row.id, pickTeamName: row.winnerTeamName! })), "nba_cup"))
      .toEqual({ totalScore: 9, correctPicks: 5, resolvedPicks: 5 })
    expect(roundPointsTable("nba_cup")).toEqual([
      { round: "cup_group_play", points: 1 }, { round: "cup_quarterfinals", points: 1 },
      { round: "cup_semifinals", points: 2 }, { round: "cup_championship", points: 4 },
    ])
  })

  it("awards no points for an incorrect, pending or missing group-game pick", () => {
    const final = game("final", "cup_group_play", "Boston Celtics")
    expect(getPlayoffPickResult(final, { pickTeamName: "Charlotte Hornets" }, "nba_cup")).toMatchObject({ status: "wrong", points: 0 })
    expect(getPlayoffPickResult(game("pending", "cup_group_play"), { pickTeamName: "Boston Celtics" }, "nba_cup")).toMatchObject({ status: "pending", points: 0 })
    expect(getPlayoffPickResult(final, null, "nba_cup")).toMatchObject({ status: "no_pick", points: 0 })
    expect(getPlayoffPickResult(final, { pickTeamName: "Boston Celtics" }, "nba_cup")).toMatchObject({ status: "correct", points: 1 })
  })

  it("adds pending group games to potential even after that team lost another group game", () => {
    const games = [
      game("won", "cup_group_play", "Boston Celtics"),
      game("lost", "cup_group_play", "Charlotte Hornets"),
      game("pending", "cup_group_play"),
      game("semi", "cup_semifinals"),
    ]
    expect(scoreAndPotential(games, games.map((row) => ({ seriesId: row.id, pickTeamName: "Boston Celtics" })), "nba_cup"))
      .toEqual({ totalScore: 1, correctPicks: 1, resolvedPicks: 2, potentialTotal: 4 })
  })

  it("counts only picks finalized before each tipoff, including group play", () => {
    const games = [
      { ...game("past", "cup_group_play", "Boston Celtics"), startsAt: "2026-10-30T23:00:00Z" },
      { ...game("ontime", "cup_group_play", "Boston Celtics"), startsAt: "2026-11-06T23:00:00Z" },
    ]
    const picks = games.map((row) => ({ seriesId: row.id, pickTeamName: "Boston Celtics" }))
    const eligible = eligibleNbaCupPicks(games, picks, "2026-10-30T23:00:00Z")
    expect(scorePlayoffEntryPicks(games, eligible, "nba_cup")).toEqual({ totalScore: 1, correctPicks: 1, resolvedPicks: 1 })
    expect(eligibleNbaCupPicks(games, picks, null)).toEqual([])
  })
})
