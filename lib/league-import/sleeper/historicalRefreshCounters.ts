import type { SleeperHistoricalMatchupSyncSummary } from './SleeperHistoricalMatchupSyncService'

/**
 * What the matchup sync did across one run of `/api/cron/sleeper-historical-refresh`.
 *
 * ⚠ WHY THE CRON SUMS THESE AT ALL. Each league's backfill returns a full summary, and the route
 * used to keep only "refreshed / failed" per league. That hid the one thing worth watching after
 * the completion gate changed: whether finished seasons stored mid-season are being fetched
 * ONCE (`completedRefreshed`) and then left alone (`skippedComplete`). A league also counted as
 * "refreshed" when its matchup sync had failed, because that sync reports its error in the
 * summary instead of throwing — `leaguesWithError` is the only place that shows up.
 *
 * ⚠ PURE. The route owns the loop; this only adds numbers.
 */
export type MatchupSeasonCounters = {
  /** Seasons whose matchups and bracket were fetched and written. */
  processed: number
  /** Completed seasons left alone because their stored row is settled. */
  skippedComplete: number
  /** Completed seasons fetched once more because their stored row was written before they settled. */
  completedRefreshed: number
  /** Leagues whose matchup sync reported an error (the league itself may still count as refreshed). */
  leaguesWithError: number
}

export function emptyMatchupSeasonCounters(): MatchupSeasonCounters {
  return { processed: 0, skippedComplete: 0, completedRefreshed: 0, leaguesWithError: 0 }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** Adds one league's matchup summary. A missing summary adds nothing. */
export function addMatchupSeasonCounters(
  counters: MatchupSeasonCounters,
  matchups: SleeperHistoricalMatchupSyncSummary | null | undefined,
): MatchupSeasonCounters {
  if (!matchups) return counters
  counters.processed += count(matchups.seasonsProcessed)
  counters.skippedComplete += count(matchups.seasonsSkippedComplete)
  counters.completedRefreshed += count(matchups.completedSeasonsRefreshed)
  if (matchups.error) counters.leaguesWithError += 1
  return counters
}
