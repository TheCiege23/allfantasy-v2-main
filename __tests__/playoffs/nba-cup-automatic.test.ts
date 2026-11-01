import { afterEach, describe, expect, it, vi } from "vitest"
import group from "../../contracts/espn/fixtures/scoreboard.NBA.20261106.json"
import quarters from "../../contracts/espn/fixtures/scoreboard.NBA.20251209.json"
import semis from "../../contracts/espn/fixtures/scoreboard.NBA.20251213.json"
import final from "../../contracts/espn/fixtures/scoreboard.NBA.20251216.json"
import { assignNbaCupSlots, eligibleNbaCupPicks, nbaCupLockedReason, parseNbaCupScoreboard } from "@/lib/playoffs/nbaCupTournament"
import { getPlayoffCompletionSummary } from "@/lib/playoffs/playoffCompletion"
import { scoreAndPotential } from "@/lib/playoffs/playoffCompetition"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"

afterEach(() => vi.useRealTimers())

describe("automatically published NBA Cup games", () => {
  it("reads real group-play teams, time, venue and city from the captured response", () => {
    const games = parseNbaCupScoreboard(group, 2026)
    expect(games).toHaveLength(9)
    expect(games[0]).toMatchObject({ round: "cup_group_play", homeTeamName: "Atlanta Hawks", awayTeamName: "Washington Wizards", startsAt: "2026-11-07T00:00:00.000Z", venue: "State Farm Arena", location: "Atlanta, GA", winnerTeamName: null })
  })
  it("verifies all three knockout stages, including the final's different label", () => {
    expect(parseNbaCupScoreboard(quarters, 2025).map((game) => game.round)).toEqual(["cup_quarterfinals", "cup_quarterfinals"])
    expect(parseNbaCupScoreboard(semis, 2025).map((game) => game.round)).toEqual(["cup_semifinals", "cup_semifinals"])
    expect(parseNbaCupScoreboard(final, 2025)[0]).toMatchObject({ round: "cup_championship", status: "final", winnerTeamName: "New York Knicks" })
  })
  it("ignores ordinary NBA games, wrong seasons, ambiguous finals and unknown labels", () => {
    const regular = structuredClone(group)
    regular.events[0].competitions[0].notes = []
    expect(parseNbaCupScoreboard(regular, 2026)).toHaveLength(8)
    expect(parseNbaCupScoreboard(group, 2025)).toEqual([])
    const tied = structuredClone(final)
    tied.events[0].competitions[0].competitors.forEach((team) => { team.score = "100" })
    expect(parseNbaCupScoreboard(tied, 2025)[0].winnerTeamName).toBeNull()
  })
  it("keeps event identities and knockout slots stable when game dates change", () => {
    const games = assignNbaCupSlots(parseNbaCupScoreboard(quarters, 2025))
    const refreshed = assignNbaCupSlots([...games].reverse().map((game) => ({ ...game, seriesNumber: undefined, startsAt: "2025-12-11T00:00:00Z" })), games)
    expect(refreshed.map((game) => [game.eventId, game.seriesNumber]).sort()).toEqual(games.map((game) => [game.eventId, game.seriesNumber]).sort())
    const groups = assignNbaCupSlots(parseNbaCupScoreboard(group, 2026))
    expect(new Set(groups.map((game) => game.seriesNumber)).size).toBe(9)
    expect(groups.every((game) => game.seriesNumber! > 7)).toBe(true)
  })
  it("fails closed for postponed games and seed placeholders", () => {
    const postponed = structuredClone(group)
    postponed.events[0].status.type.name = "STATUS_POSTPONED"
    const game = parseNbaCupScoreboard(postponed, 2026)[0]
    expect(game.startsAt).toBeNull()
    expect(nbaCupLockedReason(game)).toMatch(/confirmed/)
    expect(nbaCupLockedReason({ ...game, startsAt: "2099-11-06T00:00:00Z", homeTeamName: "EAST1" })).toMatch(/confirmed/)
  })
})

describe("NBA Cup remaining-games competition", () => {
  it("allows upcoming games after earlier games started, with an exact tipoff boundary", () => {
    const [game] = parseNbaCupScoreboard(group, 2026)
    const tipoff = Date.parse(game.startsAt!)
    expect(nbaCupLockedReason(game, tipoff - 1)).toBeNull()
    expect(nbaCupLockedReason(game, tipoff)).toMatch(/locked/)
    const later = { ...game, startsAt: new Date(tipoff + 86400000).toISOString() }
    expect(nbaCupLockedReason(later, tipoff + 1)).toBeNull()
  })
  it("finalizes available games without requiring past games or unconfirmed knockout slots", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-07T01:00:00Z"))
    const [game] = parseNbaCupScoreboard(group, 2026)
    const rows = buildPlayoffTemplate({ sport: "nba_cup", seasonYear: 2026 }).map((row) => ({ ...row, id: String(row.seriesNumber) }))
    const upcoming = { ...rows[0], ...game, id: "upcoming", startsAt: "2026-11-14T00:00:00Z" }
    const past = { ...upcoming, id: "past", startsAt: "2026-11-07T00:00:00Z" }
    const result = getPlayoffCompletionSummary([...rows, past, upcoming], [{ id: "pick", entryId: "entry", seriesId: "upcoming", pickTeamName: upcoming.homeTeamName, createdAt: "", updatedAt: "" }], { sport: "nba_cup", lockRule: "series_start" })
    expect(result.isSubmittable).toBe(true)
    expect(result.requiredSeriesIds).toEqual(["upcoming"])
  })
  it("does not award draft picks finalized after tipoff, including exact tipoff", () => {
    const games = [{ id: "past", startsAt: "2026-11-07T00:00:00Z" }, { id: "future", startsAt: "2026-11-14T00:00:00Z" }]
    const picks = [{ seriesId: "past" }, { seriesId: "future" }]
    expect(eligibleNbaCupPicks(games, picks, null)).toEqual([])
    expect(eligibleNbaCupPicks(games, picks, "2026-11-07T00:00:00Z")).toEqual([{ seriesId: "future" }])
  })
  it("keeps a team alive after losing a group game and uses the displayed group points", () => {
    const games = [{ id: "past", round: "cup_group_play" as const, homeTeamName: "Boston Celtics", awayTeamName: "Charlotte Hornets", winnerTeamName: "Charlotte Hornets", liveHomeScore: 100, liveAwayScore: 110 }, { id: "future", round: "cup_quarterfinals" as const, homeTeamName: "Boston Celtics", awayTeamName: "Miami Heat", winnerTeamName: null, liveHomeScore: null, liveAwayScore: null }]
    expect(scoreAndPotential(games, [{ seriesId: "past", pickTeamName: "Charlotte Hornets" }, { seriesId: "future", pickTeamName: "Boston Celtics" }], "nba_cup")).toMatchObject({ totalScore: 1, potentialTotal: 2 })
  })
})
