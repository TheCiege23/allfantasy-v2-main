/**
 * When the shell should pull the user's lineups from their platforms on its own.
 *
 * ⚠ WHY THIS EXISTS. Reported 2026-10-17: the home said "Jeremiyah Love is Out — swap in J.K.
 * Dobbins or Tyler Allgeier" after the user had already benched Love on Sleeper. The shell DOES
 * re-render on resume and every two minutes, but what it re-renders from is the stored roster, which
 * only the background lane refreshes (measured 2026-09-27: Sleeper rosters a median 2.2h old), and
 * the home's portfolio summary on top of it (up to ~13 min). Re-rendering stale rows faster changes
 * nothing; the rows themselves have to move. "Refresh my lineups" already does exactly that — this
 * runs it for the user at the moments they would otherwise press it: opening the app, coming back to
 * it, and opening a league.
 *
 * Bounded three ways so a busy user cannot turn it into provider load: this client-side gap, the
 * route's own per-user rate limit (8/min), and the collector's skip of any league attempted in the
 * last three minutes.
 */

/** Minimum gap between two automatic account-wide runs from one tab. */
export const AUTO_SYNC_ACCOUNT_GAP_MS = 3 * 60_000
/** Minimum gap between two automatic runs for the same league (opening it again, swiping back). */
export const AUTO_SYNC_LEAGUE_GAP_MS = 2 * 60_000
/** How long the tab must have been hidden before a return counts as "coming back". */
export const AUTO_SYNC_RESUME_HIDDEN_MS = 60_000
/** Batches per automatic run. Each is ~20s of server time; the manual button keeps its own, larger cap. */
export const AUTO_SYNC_MAX_ROUNDS = 3

/** True when a run last made at `lastAt` (ms, or null for never) may run again at `now`. */
export function autoSyncDue(lastAt: number | null, now: number, gapMs: number): boolean {
  if (lastAt == null || !Number.isFinite(lastAt)) return true
  // A clock that moved backwards must not lock the user out until it catches up.
  if (lastAt > now) return true
  return now - lastAt >= gapMs
}

export const AUTO_SYNC_STORAGE_PREFIX = 'af:lineup-auto-sync:'

export function autoSyncStorageKey(leagueId: string | null): string {
  return `${AUTO_SYNC_STORAGE_PREFIX}${leagueId ?? 'all'}`
}
