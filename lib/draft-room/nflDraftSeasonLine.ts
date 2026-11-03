import { buildNflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { normalizeNflWeeklyStats } from '@/lib/scoring-runtime/nflStatNormalization'
import type { RollingInsightsSeasonSlice } from '@/lib/draft/analytics/nfl-rolling-insights-draft-analytics'

/** One observed season throughout the row. Never fill missing boxes with zero or a projection. */
export function nflDraftSeasonLine(
  row: RollingInsightsSeasonSlice | null,
  detail: unknown,
  position: string,
  season: number,
  score: ((stats: Record<string, number>, position?: string | null) => number) | null,
) {
  if (!row || ![String(season), String(season - 1)].includes(String(row.season)) || !(Number(row.gamesPlayed) > 0)) return null
  const box = detail ?? row.stats
  if (!box || typeof box !== 'object' || Array.isArray(box)) return null
  const stats = normalizeNflWeeklyStats(box)
  if (!Object.keys(stats).length) return null
  const interceptions = (box as Record<string, unknown>).passing_interceptions
  if (typeof interceptions === 'number' && Number.isFinite(interceptions)) stats.pass_int = interceptions
  // These are the documented offensive stat mappings. Do not manufacture kicker/DST
  // points from an incomplete season aggregate lacking the required distance/opponent splits.
  const points = score && ['QB', 'RB', 'WR', 'TE', 'FB'].includes(position.toUpperCase()) ? score(stats, position) : null
  const perGame = points != null && Number.isFinite(points) ? points / Number(row.gamesPlayed) : null
  const splits = buildNflDraftProjectionSplits({
    position, statsJson: box, snapshotExpectedPoints: null,
    riSeasonFantasyPoints: points, projectedPointsPerGame: perGame,
  })
  return splits ? { splits, season: row.season, fantasyPointsPerGame: perGame } : null
}
