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
 * ⚠ `unknown` IS A REAL OUTCOME, NOT A PLACEHOLDER. A shape we cannot read says
 * so; reporting it as `failed` would replace one false claim with another.
 *
 * Two shapes are read. Sleeper returns `{ backfill: { success, seasonsImported, … } }`.
 * Yahoo, ESPN, MFL and Fantrax share a flat one: `{ attempted, skipped, error?,
 * seasonsDiscovered?, seasonsImported? }`. Until 2026-11-19 only the first was
 * read, so every finished ESPN history run was recorded `unknown` with no counts
 * (measured on staging: 1 season, 70 matchups and 160 draft picks written, status
 * `unknown`). In the flat shape a run that threw carries `error`, and a run that
 * finished carries a numeric `seasonsImported`; anything else stays `unknown`.
 * ⚠ Its `seasonsDiscovered` counts the CURRENT season too, unlike Sleeper's.
 *
 * The counts are the load-bearing part. `complete` alone cannot distinguish "this
 * league has no prior seasons" from "three seasons exist and none imported";
 * `seasonsDiscovered` and `seasonsImported` can.
 */

type BackfillStatus = 'complete' | 'failed' | 'skipped' | 'unknown'

type BackfillOutcome = {
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
  if (!backfill) return readFlatOutcome(summary) ?? unreadable

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

/** The flat summary Yahoo, ESPN, MFL and Fantrax return. Null when it is not one. */
function readFlatOutcome(summary: Record<string, unknown>): BackfillOutcome | null {
  if (summary.attempted !== true) return null

  const counts = {
    seasonsDiscovered: num(summary.seasonsDiscovered),
    seasonsImported: num(summary.seasonsImported),
    seasonsSkipped: null,
  }

  const error = str(summary.error)
  if (error) return { status: 'failed', ...counts, failureMessage: error }

  // No error and no count means we cannot say what happened.
  if (counts.seasonsImported === null) return null

  return { status: 'complete', ...counts, failureMessage: null }
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
