import type { PlayoffPickView, PlayoffSeriesView } from "./types"

export type ProjectedBracketSide = {
  displayHomeTeamName: string
  displayAwayTeamName: string
  homeSelectable: boolean
  awaySelectable: boolean
}

export function indexSeriesByNumber(series: PlayoffSeriesView[]): Map<number, PlayoffSeriesView> {
  const map = new Map<number, PlayoffSeriesView>()
  for (const item of series) {
    map.set(item.seriesNumber, item)
  }
  return map
}

export function pickTeamNameBySeriesId(picks: PlayoffPickView[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const pick of picks) {
    map.set(pick.seriesId, pick.pickTeamName)
  }
  return map
}

function winnerFromUpstream(
  sourceSeriesNumber: number | null | undefined,
  bySeriesNumber: Map<number, PlayoffSeriesView>,
  pickBySeriesId: Map<string, string>
): string | null {
  if (sourceSeriesNumber == null) return null
  const upstream = bySeriesNumber.get(sourceSeriesNumber)
  if (!upstream) return null
  return pickBySeriesId.get(upstream.id) ?? null
}

/**
 * Computes display strings and selectable sides for bracket UI / pick validation.
 * Later rounds stay as DB placeholders ("Winner S1") until upstream series have picks.
 */
export function projectBracketSeriesSides(
  series: PlayoffSeriesView,
  bySeriesNumber: Map<number, PlayoffSeriesView>,
  pickBySeriesId: Map<string, string>
): ProjectedBracketSide {
  const homeWinner = winnerFromUpstream(series.sourceSeriesHome, bySeriesNumber, pickBySeriesId)
  const awayWinner = winnerFromUpstream(series.sourceSeriesAway, bySeriesNumber, pickBySeriesId)

  const hasHomeDep = series.sourceSeriesHome != null
  const hasAwayDep = series.sourceSeriesAway != null
  const isLeaf = !hasHomeDep && !hasAwayDep

  const displayHomeTeamName = hasHomeDep ? homeWinner ?? series.homeTeamName : series.homeTeamName
  const displayAwayTeamName = hasAwayDep ? awayWinner ?? series.awayTeamName : series.awayTeamName

  // Require every declared feeder series to have a saved pick before the matchup is selectable
  const depsSatisfied =
    isLeaf || ((!hasHomeDep || homeWinner != null) && (!hasAwayDep || awayWinner != null))

  const homeSelectable = isLeaf ? true : depsSatisfied
  const awaySelectable = isLeaf ? true : depsSatisfied

  return { displayHomeTeamName, displayAwayTeamName, homeSelectable, awaySelectable }
}

export function isValidPlayoffPickTeamName(
  series: PlayoffSeriesView,
  pickTeamName: string,
  bySeriesNumber: Map<number, PlayoffSeriesView>,
  pickBySeriesId: Map<string, string>
): boolean {
  const projected = projectBracketSeriesSides(series, bySeriesNumber, pickBySeriesId)
  if (projected.homeSelectable && projected.displayHomeTeamName === pickTeamName) return true
  if (projected.awaySelectable && projected.displayAwayTeamName === pickTeamName) return true
  return false
}
