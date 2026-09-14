/**
 * Fantasy OS — the one sync outcome that is neither a success nor a failure: the provider says the
 * league is no longer there.
 *
 * 🛑 THE LOADER ALREADY KNEW, AND NOTHING LISTENED. `fetchNormalizedForConnection` throws
 * `SyncLeagueGoneError` for a missing league and its contract says "stop, skip, note it". The
 * runner caught it like any other throw: every scope retried it, and the memoized loader releases
 * its slot on rejection, so every retry was a fresh provider read. Measured on production
 * 2026-09-14: two Sleeper leagues deleted after import (Sleeper answers 404 `null` for both) were
 * read up to 12 times per run, every cadence, at 74 and 33 consecutive failures — on both the full
 * lane and the active lane — and every run stamped the league `failed`.
 *
 * So a gone league now:
 *   - stops its run at the first scope (`runSync` `isTerminalError`), status `skipped`,
 *   - records this prefix on `lastError` and leaves `consecutiveFailures` alone (prismaSyncStore),
 *   - is not attempted again for `LEAGUE_GONE_RECHECK_MS` (the due check AND both bounded
 *     selectors — a league that is merely "not due" but still selected occupies a per-provider
 *     slot every tick, which is the starvation `selectStalestFirst` exists to prevent).
 *
 * ⚠ A DAY, NOT FOREVER. A commissioner can restore a league, and if the typed `LEAGUE_NOT_FOUND`
 * classification is ever wrong a live league loses a day, not its sync. A manual refresh
 * (`force`) ignores the window.
 *
 * ⚠ THE PREFIX IS THE DISCRIMINATOR, NOT `syncStatus` ALONE. The credential pre-flight also writes
 * `skipped`, and it must keep re-checking every heartbeat for free (see `recordSkippedConnection`);
 * a status-only test would put a manager who just connected ESPN behind a 24-hour wait.
 */
export const LEAGUE_GONE_RECHECK_MS = 24 * 60 * 60_000
export const LEAGUE_GONE_ERROR_PREFIX = 'league gone at provider: '

export type LeagueGoneStateRow = {
  syncStatus?: string | null
  lastError?: string | null
  lastAttemptedSyncAt?: Date | null
}

/** The last run stopped because the provider said the league does not exist. */
export function isLeagueGoneState(row: LeagueGoneStateRow | null | undefined): boolean {
  return Boolean(
    row &&
      row.syncStatus === 'skipped' &&
      row.lastAttemptedSyncAt &&
      typeof row.lastError === 'string' &&
      row.lastError.startsWith(LEAGUE_GONE_ERROR_PREFIX),
  )
}

/** Gone, and checked recently enough that asking the provider again would learn nothing new. */
export function isInLeagueGoneBackoff(row: LeagueGoneStateRow | null | undefined, now: Date): boolean {
  if (!isLeagueGoneState(row)) return false
  return now.getTime() - (row!.lastAttemptedSyncAt as Date).getTime() < LEAGUE_GONE_RECHECK_MS
}
