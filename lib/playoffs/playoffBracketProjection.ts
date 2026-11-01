import type { PlayoffPickView, PlayoffSeriesView } from "./types"
import { NFL_PLACEHOLDER, nflDivisionalMatchups, nflImpliedSources } from "./nflPlayoffs"

export const PLAYOFF_UNRESOLVED_SERIES_MESSAGE = "Pick earlier round winners first."
export const PLAYOFF_OFFICIAL_MATCHUP_TBD_MESSAGE = "Official matchup TBD."

function pickForSeries(picks: PlayoffPickView[], seriesId: string): PlayoffPickView | null {
  return picks.find((pick) => pick.seriesId === seriesId) ?? null
}

function resolveProjectedTeamName(
  series: PlayoffSeriesView,
  sourceSeriesNumber: number | null,
  fallbackName: string,
  bySeriesNumber: Map<number, PlayoffSeriesView>,
  picks: PlayoffPickView[],
  includeUserPicks: boolean,
): string {
  if (!sourceSeriesNumber) return fallbackName
  const source = bySeriesNumber.get(sourceSeriesNumber)
  if (includeUserPicks) {
    const savedPick = source ? pickForSeries(picks, source.id)?.pickTeamName?.trim() : null
    return savedPick || `Winner S${sourceSeriesNumber}`
  }
  if (!source) return fallbackName
  if (isOfficialTeamName(fallbackName)) return fallbackName
  return source.winnerTeamName?.trim() || fallbackName
}

export function isOfficialTeamName(value: string | null | undefined): boolean {
  const name = String(value ?? "").trim()
  if (!name) return false
  // Seed slots remain pickable before official seeding; feeder winners do not.
  return !/^Winner\s+S\d+$/i.test(name) &&
    // NFL divisional slots before the reseeding is decided (nflPlayoffs.ts).
    !NFL_PLACEHOLDER.test(name) &&
    !/^(East|Eastern|West|Western)\s+Winner\s+[AB]$/i.test(name) &&
    !/Champion$/i.test(name) &&
    !/Winner\s+[AB]$/i.test(name)
}

export function buildProjectedPlayoffSeries(
  series: PlayoffSeriesView[],
  picks: PlayoffPickView[],
  options: { includeUserPicks?: boolean } = {}
): PlayoffSeriesView[] {
  const includeUserPicks = options.includeUserPicks ?? true
  const bySeriesNumber = new Map(series.map((item) => [item.seriesNumber, item]))

  const projected = series.map((item) => ({
    ...item,
    homeTeamName: resolveProjectedTeamName(item, item.sourceSeriesHome, item.homeTeamName, bySeriesNumber, picks, includeUserPicks),
    awayTeamName: resolveProjectedTeamName(item, item.sourceSeriesAway, item.awayTeamName, bySeriesNumber, picks, includeUserPicks),
  }))
  return projectNflDivisional(projected, picks, includeUserPicks)
}

/**
 * NFL divisional games are RESEEDED from the three Wild Card results of their
 * conference, so they have no feeder edges for `resolveProjectedTeamName` to
 * follow. Fill them from the entry's Wild Card picks (projection) or the
 * official Wild Card winners — unless the official matchup is already
 * published, which in official mode always wins.
 */
function projectNflDivisional(series: PlayoffSeriesView[], picks: PlayoffPickView[], includeUserPicks: boolean): PlayoffSeriesView[] {
  if (!series.some((item) => item.round === "nfl_divisional")) return series
  const winners = new Map<number, string>()
  for (const item of series) {
    if (item.round !== "nfl_wild_card") continue
    const name = includeUserPicks ? pickForSeries(picks, item.id)?.pickTeamName?.trim() : item.winnerTeamName?.trim()
    if (name) winners.set(item.seriesNumber, name)
  }
  const matchups = nflDivisionalMatchups(series, winners)
  return series.map((item) => {
    if (item.round !== "nfl_divisional") return item
    if (!includeUserPicks && isOfficialTeamName(item.homeTeamName) && isOfficialTeamName(item.awayTeamName)) return item
    const matchup = matchups.get(item.seriesNumber)
    return matchup ? { ...item, ...matchup } : item
  })
}

export function isPlayoffSeriesResolved(series: PlayoffSeriesView): boolean {
  return isOfficialTeamName(series.homeTeamName) && isOfficialTeamName(series.awayTeamName)
}

export function getNextActionablePlayoffSeries(
  series: PlayoffSeriesView[],
  picks: PlayoffPickView[]
): PlayoffSeriesView | null {
  const pickedSeriesIds = new Set(picks.map((pick) => pick.seriesId))
  return series
    .slice()
    .sort((a, b) => a.roundIndex - b.roundIndex || a.seriesNumber - b.seriesNumber)
    .find((item) => isPlayoffSeriesResolved(item) && !pickedSeriesIds.has(item.id)) ?? null
}

export function getDependentPlayoffSeriesIds(
  changedSeriesId: string,
  series: PlayoffSeriesView[]
): Set<string> {
  const changed = series.find((item) => item.id === changedSeriesId)
  const dependentIds = new Set<string>()
  if (!changed) return dependentIds

  const queue = [changed.seriesNumber]
  while (queue.length > 0) {
    const seriesNumber = queue.shift()
    if (!seriesNumber) continue
    for (const item of series) {
      const fed = item.sourceSeriesHome === seriesNumber || item.sourceSeriesAway === seriesNumber ||
        nflImpliedSources(item, series).includes(seriesNumber)
      if (!fed) continue
      if (dependentIds.has(item.id)) continue
      dependentIds.add(item.id)
      queue.push(item.seriesNumber)
    }
  }

  return dependentIds
}
