/**
 * Reads the real outcome of a historical backfill run.
 *
 * ⚠ WHY THIS EXISTS. Both callers of `runHistoricalBackfill` used to stamp
 * `historicalBackfillStatus: 'complete'` from `.then()` and discard the result
 * object entirely. `.then()` means "the promise resolved", not "seasons were
 * imported" — so a run that discovered nothing, or returned `success: false`
 * with a `failureMessage`, was recorded identically to one that imported ten
 * years of history.
 *
 * Measured on production 2026-08-20: 52 of 63 leagues read `complete` with zero
 * errors, and `/api/leagues/{id}/history` returned exactly one season (the
 * current one) for a league whose 2025 season is sitting on Sleeper, finished,
 * with real scores and records. The backfill had run for 65 seconds and reported
 * success. The honest status was written to `dynasty_backfill_status`, which no
 * route in `app/` reads — so the failure was unobservable from inside the
 * product at every layer.
 *
 * ⚠ `unknown` IS A REAL OUTCOME, NOT A PLACEHOLDER. Only the Sleeper service
 * returns the `{ backfill: { success, seasonsImported, … } }` shape; Yahoo, ESPN,
 * MFL and Fantrax return their own. Reporting those as `failed` would replace one
 * false claim with another, so a shape we cannot read says so.
 *
 * The counts are the load-bearing part. `complete` alone cannot distinguish "this
 * league has no prior seasons" from "three seasons exist and none imported";
 * `seasonsDiscovered` and `seasonsImported` can.
 */

export type BackfillStatus = 'complete' | 'failed' | 'skipped' | 'unknown'

export type BackfillOutcome = {
  status: BackfillStatus
  /** Prior seasons the provider chain turned up. Null when unreadable. */
  seasonsDiscovered: number | null
  /** Seasons actually written. Null when unreadable. */
  seasonsImported: number | null
  /** Seasons already present and deliberately not refetched. Null when unreadable. */
  seasonsSkipped: number | null
  /** The provider's own reason, verbatim. Null when it did not give one. */
  failureMessage: string | null
}

function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function readBackfillOutcome(result: unknown): BackfillOutcome {
  const unreadable: BackfillOutcome = {
    status: 'unknown',
    seasonsDiscovered: null,
    seasonsImported: null,
    seasonsSkipped: null,
    failureMessage: null,
  }

  const summary = rec(result)
  if (!summary) return unreadable

  // The service can decline to run at all — that is neither success nor failure.
  if (summary.skipped === true) {
    return { ...unreadable, status: 'skipped', failureMessage: str(summary.reason) }
  }

  const backfill = rec(summary.backfill)
  if (!backfill) return unreadable

  const success = backfill.success
  if (typeof success !== 'boolean') return unreadable

  return {
    status: success ? 'complete' : 'failed',
    seasonsDiscovered: num(backfill.seasonsDiscovered),
    seasonsImported: num(backfill.seasonsImported),
    seasonsSkipped: num(backfill.seasonsSkipped),
    failureMessage: str(backfill.failureMessage),
  }
}

/**
 * The settings patch to persist alongside the status. Kept here so the import
 * path and the retry path cannot drift into recording different fields for the
 * same run — which is how the original gap survived: two writers, one of them
 * the only place anyone looked.
 */
export function backfillSettingsPatch(
  outcome: BackfillOutcome,
  completedAtIso: string,
): Record<string, unknown> {
  return {
    historicalBackfillStatus: outcome.status,
    historicalBackfillCompletedAt: completedAtIso,
    historicalBackfillError: outcome.failureMessage,
    historicalBackfillSeasonsDiscovered: outcome.seasonsDiscovered,
    historicalBackfillSeasonsImported: outcome.seasonsImported,
    historicalBackfillSeasonsSkipped: outcome.seasonsSkipped,
  }
}
