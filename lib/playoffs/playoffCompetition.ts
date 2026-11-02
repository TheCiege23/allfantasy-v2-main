import { pointsForSeries, scorePlayoffEntryPicks } from "./playoffScoring"
import type { PlayoffPickView, PlayoffSeriesView, PlayoffSport } from "./types"
import { nflLockRows } from "./nflPlayoffs"

export const FREE_BRACKETS_PER_TOURNAMENT = 1
export const PAID_BRACKETS_PER_TOURNAMENT = 5

export function isSingleGameBracketSport(sport: string | null | undefined): sport is "ncaaf" | "nba_cup" | "nfl" {
  return sport === "ncaaf" || sport === "nba_cup" || sport === "nfl"
}

/**
 * The season a new pool belongs to when the caller names none.
 *
 * 🛑 FOOTBALL PLAYOFFS ARE PLAYED IN THE YEAR AFTER THEIR SEASON STARTS. Every CFP and NFL
 * store here is keyed by the season's START year (seeds, standings, the NFL snapshot), so a
 * pool created in January used to be filed under the NEW year and find no field at all —
 * an empty bracket, silently. January and February belong to the previous season.
 */
export function defaultPlayoffSeasonYear(sport: PlayoffSport, now = new Date()): number {
  const year = now.getUTCFullYear()
  return (sport === "nfl" || sport === "ncaaf") && now.getUTCMonth() <= 1 ? year - 1 : year
}

/**
 * One published, season-wide deadline; a missing time never means unlimited access.
 *
 * ⚠ FOR THE NFL ONLY THE WILD CARD ROUND COUNTS. Its later rounds are not
 * scheduled until the round before ends, so "every game has a time" would never
 * be true before the bracket must lock (`nflLockRows`).
 */
export function firstGameDeadline(
  series: Array<Pick<PlayoffSeriesView, "startsAt"> & { round?: string | null }>,
): number | null {
  const lockRows = nflLockRows(series)
  if (!lockRows.length || lockRows.some((game) => !game.startsAt)) return null
  const times = lockRows.map((game) => Date.parse(String(game.startsAt)))
  return times.every(Number.isFinite) ? Math.min(...times) : null
}

export function assertBracketOpen(
  series: Array<Pick<PlayoffSeriesView, "startsAt"> & { round?: string | null }>,
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
  const final = series.find((game) => game.round === "cfp_championship" || game.round === "cup_championship" || game.round === "nfl_super_bowl")
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
