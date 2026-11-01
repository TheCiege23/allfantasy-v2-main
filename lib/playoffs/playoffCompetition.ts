import { pointsForSeries, scorePlayoffEntryPicks } from "./playoffScoring"
import type { PlayoffPickView, PlayoffSeriesView, PlayoffSport } from "./types"

export const FREE_BRACKETS_PER_TOURNAMENT = 1
export const PAID_BRACKETS_PER_TOURNAMENT = 5

export function isSingleGameBracketSport(sport: string | null | undefined): sport is "ncaaf" | "nba_cup" {
  return sport === "ncaaf" || sport === "nba_cup"
}

/** One published, season-wide deadline; a missing time never means unlimited access. */
export function firstGameDeadline(
  series: Array<Pick<PlayoffSeriesView, "startsAt">>,
): number | null {
  if (!series.length || series.some((game) => !game.startsAt)) return null
  const times = series.map((game) => Date.parse(String(game.startsAt)))
  return times.every(Number.isFinite) ? Math.min(...times) : null
}

export function assertBracketOpen(
  series: Array<Pick<PlayoffSeriesView, "startsAt">>,
  now = Date.now(),
): number {
  const deadline = firstGameDeadline(series)
  if (deadline == null) throw new Error("The official game schedule must be published before picks open.")
  if (now >= deadline) throw new Error("Brackets locked when the first game began.")
  return deadline
}

type ResultSeries = Pick<
  PlayoffSeriesView,
  "id" | "round" | "winnerTeamName" | "homeTeamName" | "awayTeamName" | "liveHomeScore" | "liveAwayScore"
>

/** Potential is earned points plus every still-possible saved pick; eliminated teams add nothing. */
export function scoreAndPotential(
  series: ResultSeries[],
  picks: Array<Pick<PlayoffPickView, "seriesId" | "pickTeamName">>,
  sport: PlayoffSport,
): { totalScore: number; potentialTotal: number; correctPicks: number; resolvedPicks: number } {
  const scored = scorePlayoffEntryPicks(series, picks, sport)
  const byId = new Map(series.map((game) => [game.id, game]))
  const eliminated = new Set<string>()
  for (const game of series) {
    if (!game.winnerTeamName || game.round === "cup_group_play") continue
    const loser = game.winnerTeamName === game.homeTeamName ? game.awayTeamName
      : game.winnerTeamName === game.awayTeamName ? game.homeTeamName : null
    if (loser) eliminated.add(loser)
  }
  let potentialTotal = scored.totalScore
  for (const pick of picks) {
    const game = byId.get(pick.seriesId)
    if (!game || game.winnerTeamName || (game.round !== "cup_group_play" && eliminated.has(pick.pickTeamName))) continue
    if (sport === "nba_cup" && ![game.homeTeamName, game.awayTeamName].includes(pick.pickTeamName) && !/^(?:Winner|East Champion|West Champion)/i.test(game.homeTeamName)) continue
    potentialTotal += pointsForSeries(game, sport)
  }
  return { ...scored, potentialTotal }
}

export function championshipTotal(
  series: ResultSeries[],
): number | null {
  const final = series.find((game) => game.round === "cfp_championship" || game.round === "cup_championship")
  return final?.winnerTeamName && final.liveHomeScore != null && final.liveAwayScore != null
    ? final.liveHomeScore + final.liveAwayScore : null
}

export type RankedBracket = {
  id: string
  totalScore: number
  potentialTotal: number
  correctPicks: number
  tiebreakerTotalScore: number | null
}

/** Equal scores and equal tiebreakers share a rank. Potential is shown, never used as a tiebreak. */
export function rankBrackets<T extends RankedBracket>(entries: T[], finalTotal: number | null): Array<T & { rank: number }> {
  const error = (entry: T) => finalTotal == null || entry.tiebreakerTotalScore == null
    ? Number.POSITIVE_INFINITY : Math.abs(entry.tiebreakerTotalScore - finalTotal)
  const sorted = [...entries].sort((a, b) =>
    b.totalScore - a.totalScore ||
    error(a) - error(b) ||
    b.correctPicks - a.correctPicks ||
    a.id.localeCompare(b.id))
  let rank = 0
  return sorted.map((entry, index) => {
    const prev = sorted[index - 1]
    if (!prev || entry.totalScore !== prev.totalScore || error(entry) !== error(prev) ||
      entry.correctPicks !== prev.correctPicks) rank = index + 1
    return { ...entry, rank }
  })
}
