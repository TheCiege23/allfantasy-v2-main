/**
 * `league_dynasty_seasons.metadata` is written by TWO syncs, and it must be merged, never replaced.
 *
 * 🛑 WHY THIS IS SHARED RATHER THAN A HELPER IN ONE FILE. `persistDynastySeason` REPLACES the
 * whole `metadata` column. Two services write it for the same (league, season):
 *
 *   SleeperHistoricalSeasonStateSyncService  → settings, scoring, playoff settings, status
 *   SleeperHistoricalMatchupSyncService      → playoffStructure (champion, bracket), matchupHistory
 *
 * The matchup sync merged; the season-state sync did not, so its write dropped `playoffStructure`
 * and `matchupHistory`. That was survivable only because the matchup sync ran afterwards in the
 * same backfill and wrote them back.
 *
 * ⚠ THAT SAFETY NET IS GONE. Since the completion gate learned to skip a SETTLED season
 * (`isStoredSeasonSettled`), the matchup sync no longer rewrites a finished season — so a
 * season-state write that replaced the row would destroy the stored title game permanently, and
 * nothing would ever put it back.
 *
 * Measured 2026-09-18, test and production: 0 rows are exposed today, because every row holding
 * `playoffStructure` also has a season-end roster snapshot, which makes the season-state gate skip
 * it. This is prevention, not repair.
 */
export function mergeSeasonMetadata(
  existing: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return next
  }

  return {
    ...(existing as Record<string, unknown>),
    ...next,
  }
}

/**
 * Did the last write of this row see a season Sleeper already reported `complete`?
 *
 * The season-state sync stores the provider's `status` in the row it writes, so a row stamped
 * `complete` was captured after the season ended and its roster snapshot is final. A row stamped
 * anything else was captured while the season was still being played, and the "season end"
 * snapshot it left behind is a mid-season roster wearing that name.
 */
export function storedSeasonStatusIsComplete(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  return (metadata as Record<string, unknown>).status === 'complete'
}
