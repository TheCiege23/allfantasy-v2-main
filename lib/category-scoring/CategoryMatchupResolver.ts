/**
 * Pure H2H-category matchup resolver.
 *
 * Given two teams' aggregated stat totals and a list of category definitions,
 * returns the per-category winner breakdown plus aggregate counts. No DB, no
 * IO, no side effects — this is the unit the weekly processor will call once
 * it accumulates team stats in category-mode leagues.
 *
 * Tie handling: exact numeric equality after ratio computation counts as a
 * tie (winner === 'tie'); neither team's win count increments. Ratio cats
 * with zero denominator on both sides also tie.
 */

import type {
  CategoryDefinition,
  CategoryMatchupCategoryResult,
  CategoryMatchupResult,
  TeamStatTotals,
} from './types'

// Native weekly basketball stats use short canonical keys; provider aggregates can use long keys.
// Prefer the stored primary key without adding aliases twice.
const NBA_STAT_KEYS: Record<string, string> = { points_scored: 'pts', rebound: 'reb', assist: 'ast', steal: 'stl', block: 'blk', turnover: 'to', three_point_made: 'threes', field_goals_made: 'fgm', field_goals_attempted: 'fga', free_throws_made: 'ftm', free_throws_attempted: 'fta' }
const categoryStat = (totals: TeamStatTotals, key: string) => totals[key] ?? totals[NBA_STAT_KEYS[key]]

export function computeCategoryValue(totals: TeamStatTotals, category: CategoryDefinition): number | null {
  const comp = category.computation
  if (comp.kind === 'sum') {
    const v = categoryStat(totals, comp.statKey)
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  // ratio
  const num = categoryStat(totals, comp.numeratorStatKey)
  const den = categoryStat(totals, comp.denominatorStatKey)
  const n = typeof num === 'number' && Number.isFinite(num) ? num : 0
  const d = typeof den === 'number' && Number.isFinite(den) ? den : 0
  if (d <= 0) return comp.unqualifiedWhenZero ? null : 0
  const extra = (comp.additionalNumeratorStatKeys ?? []).reduce((s, k) => s + (Number.isFinite(totals[k]) ? totals[k] : 0), 0)
  return (n + extra) * (comp.multiplier ?? 1) / d
}

function compareValues(
  aValue: number | null,
  bValue: number | null,
  direction: CategoryDefinition['direction'],
): 'a' | 'b' | 'tie' {
  if (aValue === bValue) return 'tie'
  if (aValue === null) return 'b'
  if (bValue === null) return 'a'
  if (direction === 'higher') return aValue > bValue ? 'a' : 'b'
  return aValue < bValue ? 'a' : 'b'
}

export function resolveCategoryMatchup(
  aTotals: TeamStatTotals,
  bTotals: TeamStatTotals,
  categories: readonly CategoryDefinition[],
): CategoryMatchupResult {
  const breakdown: CategoryMatchupCategoryResult[] = []
  let aWins = 0
  let bWins = 0
  let ties = 0

  for (const cat of categories) {
    const aValue = computeCategoryValue(aTotals, cat)
    const bValue = computeCategoryValue(bTotals, cat)
    const winner = compareValues(aValue, bValue, cat.direction)
    if (winner === 'a') aWins += 1
    else if (winner === 'b') bWins += 1
    else ties += 1
    breakdown.push({
      categoryId: cat.id,
      label: cat.label,
      aValue,
      bValue,
      winner,
    })
  }

  return { categories: breakdown, aWins, bWins, ties }
}

/**
 * Sum a list of per-player stat maps into a single team total. Kept here so
 * the pipeline integration in later turns can call one helper instead of
 * reinventing the accumulation rules (e.g., missing keys treated as 0,
 * non-finite values sanitized to 0).
 */
export function accumulateTeamTotals(
  playerStatMaps: ReadonlyArray<TeamStatTotals>,
): TeamStatTotals {
  const out: TeamStatTotals = {}
  for (const playerStats of playerStatMaps) {
    for (const key of Object.keys(playerStats)) {
      const v = playerStats[key]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      out[key] = (out[key] ?? 0) + v
    }
  }
  return out
}
