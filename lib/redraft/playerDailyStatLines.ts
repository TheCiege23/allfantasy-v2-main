import { aggregateWeeklyStats, type getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { dayKey } from './dailyLineups'

/**
 * ONE RULE FOR A DAILY-LINEUP PLAYER'S PER-DAY STAT LINES, shared by the two places that need it:
 *
 *   - the weekly sync (`syncPlayerWeeklyScoresForRedraftSeason`, lib/redraft/playerWeeklyScoreService.ts),
 *     which WRITES each line to `player_daily_scores`;
 *   - the admin stat re-ingest preview (lib/admin/statReingest.ts, via lib/stat-corrections/dailyWeekStats.ts),
 *     which builds the same lines IN MEMORY from fresh `player_game_stats` rows and scores them without
 *     writing anything.
 *
 * Moved out of the sync unchanged (2026-10-29). A second copy of the grouping or the aggregation would
 * make the preview report differences that are only the two copies disagreeing — two implementations of
 * one rule is the bug.
 */

/** dayKey → that Eastern day's raw game rows (`normalizedStatMap`s) for one player. */
export type DatedGameRows = Map<string, { day: Date; rows: unknown[] }>

/** File one `player_game_stats` row under its Eastern game day (`game_date` is already that day's UTC-midnight key). */
export function addDatedGameRow(byDay: DatedGameRows, gameDate: Date, normalizedStatMap: unknown): void {
  const key = dayKey(gameDate)
  const entry = byDay.get(key) ?? { day: gameDate, rows: [] }
  entry.rows.push(normalizedStatMap)
  byDay.set(key, entry)
}

export type PlayerDailyStatLine = { day: Date; stats: Record<string, number>; gamesPlayed: number }

/**
 * Each day's summed stat line, by the sport's weekly normalizer. A day whose rows normalize to no game or
 * to no recognised stat has NO line (it scores 0, and the sync removes any stale row for it).
 */
export function buildPlayerDailyStatLines(
  byDay: DatedGameRows,
  normalizer: NonNullable<ReturnType<typeof getDailySportNormalizer>>,
): PlayerDailyStatLine[] {
  const out: PlayerDailyStatLine[] = []
  for (const { day, rows } of byDay.values()) {
    const aggregate = aggregateWeeklyStats(rows, normalizer)
    if (aggregate.gamesCounted === 0 || !Object.keys(aggregate.stats).length) continue
    out.push({ day, stats: aggregate.stats, gamesPlayed: aggregate.gamesCounted })
  }
  return out
}
