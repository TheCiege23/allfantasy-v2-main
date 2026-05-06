/**
 * Rolling Insights soccer team season stats — draws vs ties, relegated rows.
 */

export type RollingInsightsSoccerRegularSeasonSlice = Record<string, unknown> | null | undefined

/** Canonical draws = draws ?? ties (vendor may emit either). */
export function normalizeRollingInsightsSoccerDraws(regularSeason: RollingInsightsSoccerRegularSeasonSlice): number | null {
  if (!regularSeason || typeof regularSeason !== 'object') return null
  const rs = regularSeason as Record<string, unknown>
  const d = rs.draws
  const t = rs.ties
  const pick = d ?? t
  if (pick == null || pick === '') return null
  const n = typeof pick === 'number' ? pick : Number(pick)
  return Number.isFinite(n) ? n : null
}

export function isRollingInsightsSoccerTeamRelegated(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false
  const r = row as Record<string, unknown>
  return r.relegated === true || String(r.relegated).toUpperCase() === 'TRUE'
}

/** False when relegated with `regular_season: null` — valid, not an import failure. */
export function hasRollingInsightsSoccerRegularSeasonStats(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false
  const r = row as Record<string, unknown>
  const rs = r.regular_season
  return rs != null && typeof rs === 'object'
}
