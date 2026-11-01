import { describe, expect, it } from "vitest"
import { buildBracketCoach, qualificationScenarios } from "@/lib/playoffs/bracketCoach"
import { buildMatchupEvidence, type CoachStoredGame } from "@/lib/playoffs/bracketCoachEvidence"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import type { PlayoffChallengeView, PlayoffSeriesView } from "@/lib/playoffs/types"

const now = Date.parse("2026-11-07T00:30:00Z")
const game = (id: string, extra: Partial<PlayoffSeriesView> = {}): PlayoffSeriesView => ({ ...buildPlayoffTemplate({ sport: "nba_cup", seasonYear: 2026 })[0],
  id, round: "cup_group_play", homeTeamName: "Boston Celtics", awayTeamName: "Atlanta Hawks", startsAt: "2026-11-07T00:00:00Z", status: "in_progress", ...extra })
export const coachView = (): PlayoffChallengeView => ({
  challenge: { id: "cup", name: "Private pool", ownerUserId: "me", sport: "nba_cup", seasonYear: 2026, status: "open", isTestMode: false, createdAt: "", updatedAt: "" },
  viewerUserId: "me", activeEntry: { id: "mine", name: "Mine", userId: "me", isComplete: true, finalizedAt: "2026-11-06T20:00:00Z", pickCount: 3, totalScore: 2, createdAt: "" },
  entries: [{ id: "mine", name: "Mine", userId: "me", isComplete: true, pickCount: 3, createdAt: "" },
    { id: "rival", name: "Rival", userId: "opponent", isComplete: true, pickCount: 3, finalizedAt: "2026-11-06T20:00:00Z", totalScore: 4, createdAt: "" },
    { id: "draft", name: "SECRET DRAFT", userId: "other", isComplete: false, pickCount: 1, createdAt: "" }],
  series: [game("live"), game("future", { startsAt: "2026-11-07T02:00:00Z", status: "scheduled" }), game("final", { status: "final", winnerTeamName: "Boston Celtics", startsAt: "2026-11-06T22:00:00Z" })],
  picks: ["live", "future", "final"].map((id) => ({ id, seriesId: id, entryId: "mine", pickTeamName: "Boston Celtics", createdAt: "", updatedAt: "" })), rounds: ["cup_group_play"],
})
describe("private bracket coach", () => {
  it("reveals rival picks only for locked games and excludes draft brackets", () => {
    const view = coachView()
    const result = buildBracketCoach(view, { id: "rival", name: "Rival", totalScore: 4, finalizedAt: view.entries[1].finalizedAt,
      picks: view.series.map((game) => ({ seriesId: game.id, pickTeamName: "Atlanta Hawks" })) }, now)
    expect(result.comparisons.map((row) => row.id)).toEqual(["live", "final"])
    expect(result.rooting).toEqual([expect.objectContaining({ id: "live", rootFor: "Boston Celtics", gapNow: -2, gapIfHomeWins: -1, gapIfAwayWins: -3 })])
    expect(result.rivals.map((row) => row.id)).toEqual(["rival"])
    expect(JSON.stringify(result)).not.toContain("SECRET DRAFT")
    expect(JSON.stringify(result)).not.toContain("opponent")
  })
  it("uses the viewer timezone across UTC midnight and distinguishes saved from scoring eligible", () => {
    const view = coachView(); view.activeEntry!.isComplete = false
    const result = buildBracketCoach(view, null, now, "America/New_York")
    expect(result.tonight.map((row) => row.id)).toEqual(["live", "final", "future"])
    expect(result.tonight.every((row) => !row.eligible)).toBe(true)
    expect(result.recap.pointsEarned).toBe(0)
    view.picks = []
    expect(buildBracketCoach(view, null, now).missingPicks).toBe(1)
  })
  it("excludes late finalization from rooting and earned points, including rival picks", () => {
    const view = coachView(); view.activeEntry!.finalizedAt = "2026-11-07T00:20:00Z"
    const result = buildBracketCoach(view, { id: "rival", name: "Rival", totalScore: 4, finalizedAt: "2026-11-07T00:20:00Z", picks: [{ seriesId: "live", pickTeamName: "Atlanta Hawks" }] }, now)
    expect(result.rooting).toEqual([])
    expect(result.recap.pointsEarned).toBe(0)
    expect(result.comparisons).toEqual([])
  })
  it("does not award points to a filled entry without a finalization timestamp", () => {
    const view = coachView(); view.activeEntry!.finalizedAt = null
    const result = buildBracketCoach(view, null, now)
    expect(result.entry?.finalized).toBe(false)
    expect(result.tonight.every((game) => !game.eligible)).toBe(true)
    expect(result.recap.pointsEarned).toBe(0)
  })
  it("never reveals a filled but unsubmitted rival bracket", () => {
    const view = coachView(); view.challenge.sport = "nba"; view.entries[1].finalizedAt = null
    const result = buildBracketCoach(view, { id: "rival", name: "Unsubmitted", totalScore: 4, picks: [{ seriesId: "live", pickTeamName: "Atlanta Hawks" }] }, now)
    expect(result.comparisons).toEqual([])
    expect(result.rival).toBeNull()
    expect(result.rivals).toEqual([])
  })
  it("uses sport-scoped scoring and does not mistake live leads for earned points", () => {
    const view = coachView()
    view.series[0].liveHomeScore = 80; view.series[0].liveAwayScore = 60
    expect(buildBracketCoach(view, null, now).recap.pointsEarned).toBe(1)
    view.challenge.sport = "ncaaf"; view.series[2].round = "cfp_championship"
    expect(buildBracketCoach(view, null, now).recap.pointsEarned).toBe(8)
  })
  it("computes both qualification branches without changing the real games or assigning scores", () => {
    const teams = ["Atlanta Hawks", "Boston Celtics", "Charlotte Hornets", "Chicago Bulls", "Washington Wizards"]
    const games = teams.flatMap((home, i) => teams.slice(i + 1).map((away) => game(`${home}:${away}`, { status: "scheduled", homeTeamName: home, awayTeamName: away })))
    const before = JSON.stringify(games)
    const result = qualificationScenarios(games, 2026, "Boston Celtics")
    const ownGame = result.find((row) => row.home === "Boston Celtics")!
    expect(ownGame.ifHomeWins).toMatchObject({ wins: 1, losses: 0, canWinGroup: true })
    expect(ownGame.ifAwayWins).toMatchObject({ wins: 0, losses: 1 })
    expect(JSON.stringify(games)).toBe(before)
    expect(qualificationScenarios(games, 2027, "Boston Celtics")).toEqual([])
  })
})

describe("grounded matchup facts", () => {
  it("uses verified finals once per matchup, keeps injury provenance and never invents probabilities", () => {
    const view = coachView()
    const row: CoachStoredGame = { homeTeam: "BOS", awayTeam: "ATL", homeScore: 100, awayScore: 90, status: "final", startTime: "2026-11-05T23:00:00Z", fetchedAt: "2026-11-06T02:00:00Z", source: "espn" }
    const result = buildMatchupEvidence(view, view.series[0], [row, { ...row, source: "other", fetchedAt: "2026-11-06T01:00:00Z" }],
      [{ player: "Verified player", team: "BOS", status: "Questionable", reportedAt: "2026-11-06T22:00:00Z", source: "espn" }], "Injury availability is unknown", now)
    expect(result.home.recentForm).toMatchObject({ games: 1, wins: 1 })
    expect(result.home.injuries[0]).toMatchObject({ player: "Verified player", source: "espn" })
    expect(result.home.hoursSincePreviousTipoff).toBe(25)
    expect(result.recommendation).toBeNull()
    expect(result.risks).toContain("Too few verified recent games to compare form.")
    expect(result).not.toHaveProperty("winProbability")
  })
  it("refuses to manufacture a clear lean from tied season records or live results", () => {
    const view = coachView()
    const profile = { won: 5, lost: 5, winPercentage: 50, plusMinus: null, seasonReview: "", source: "cached_standings" as const }
    view.teamProfiles = { "Boston Celtics": profile, "Atlanta Hawks": profile }
    const result = buildMatchupEvidence(view, view.series[0], [], [], "No verified injury coverage", now)
    expect(result.recommendation).toBeNull()
    expect(result.dataQuality).toBe("limited")
  })
})
