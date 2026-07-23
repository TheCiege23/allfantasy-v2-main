/**
 * Import Certification Phase A — honest historical-backfill state.
 *
 * THE PROBLEM THIS FIXES
 *
 * `persistImportedLeagueFromNormalization` stamped
 * `League.settings.historicalBackfillStatus = 'pending'` and then dispatched the backfill
 * with a bare `void`. Two things went wrong:
 *
 *   1. `'pending'` was written for EVERY provider, including ones with no backfill service
 *      at all (`runHistoricalBackfill` returns `null` for fleaflicker). Those leagues
 *      claimed a multi-season import was in flight when nothing had been started.
 *   2. The dispatch is in-process, best-effort work in a serverless runtime with no
 *      `waitUntil`/durable queue. If the instance is reclaimed after the response is sent,
 *      neither the `.then` nor the `.catch` ever runs, so the league stays `'pending'`
 *      forever — indistinguishable from genuinely in-progress work.
 *
 * WHAT THIS MODULE DOES (and deliberately does not do)
 *
 * It does NOT introduce a durable queue — that is Phase C. It makes the RECORDED STATE
 * honest about what was actually accepted:
 *
 *   - unsupported providers are stamped `'unsupported'` and never claim active work;
 *   - supported providers record `historicalBackfillDurable: false`, so a reader can tell
 *     best-effort in-process work from durably-queued work;
 *   - every dispatch carries `historicalBackfillStaleAfter`, a bounded deadline past which
 *     `'pending'` is reported as `'stale'` rather than in-progress forever.
 *
 * `'pending'` is retained as the on-disk value for supported providers because the History
 * tab and `POST /api/leagues/{id}/backfill/retry` already key on it; changing the literal
 * would silently break the existing retry path. Staleness is layered on top instead.
 *
 * Pure module: no Prisma, no I/O, `now` injected — so every branch is unit-testable.
 */

import type { ImportProvider } from './types'

/**
 * Providers with a real historical-backfill service wired into `runHistoricalBackfill`
 * (`ImportedLeagueCommitService.ts`). Fleaflicker is intentionally absent: it has no
 * backfill service, and its adapter already reports `previousSeasons: missing`.
 *
 * Keep in sync with `runHistoricalBackfill`'s provider branches — the invariant test
 * `historical-backfill-state.test.ts` fails if a provider is listed here without a
 * corresponding backfill service module on disk.
 */
export const HISTORICAL_BACKFILL_PROVIDERS: readonly ImportProvider[] = [
  'sleeper',
  'yahoo',
  'espn',
  'mfl',
  'fantrax',
]

export function providerSupportsHistoricalBackfill(provider: ImportProvider): boolean {
  return HISTORICAL_BACKFILL_PROVIDERS.includes(provider)
}

/**
 * How long an in-process backfill may remain `'pending'` before readers treat it as stale.
 *
 * Sized well above a realistic multi-season backfill (Sleeper walks up to 10 prior seasons,
 * each with drafts) but far below "forever", so a silently-killed instance surfaces as a
 * recoverable stale state instead of a permanent spinner.
 */
export const HISTORICAL_BACKFILL_STALE_AFTER_MS = 15 * 60 * 1000

/** On-disk status literals written into `League.settings`. */
export type HistoricalBackfillStatus = 'pending' | 'complete' | 'failed' | 'unsupported'

/**
 * Derived state for readers. `stale` is never persisted — it is computed when a `pending`
 * record has outlived its deadline, which is exactly the case that used to read as
 * "still running" indefinitely.
 */
export type HistoricalBackfillDerivedState =
  | 'pending'
  | 'complete'
  | 'failed'
  | 'unsupported'
  | 'stale'
  | 'unknown'

export interface HistoricalBackfillStamp {
  historicalBackfillStatus: HistoricalBackfillStatus
  /**
   * False = best-effort in-process dispatch that may not survive the serverless
   * invocation. No code path sets this to true yet; a durable dispatcher (Phase C) would.
   */
  historicalBackfillDurable: boolean
  historicalBackfillStartedAt: string | null
  /** ISO deadline after which a `pending` record is reported `stale`. Null when nothing runs. */
  historicalBackfillStaleAfter: string | null
  historicalBackfillError: string | null
}

/**
 * Build the settings patch written immediately BEFORE dispatching a backfill.
 *
 * For an unsupported provider this records `'unsupported'` with no deadline — the honest
 * statement that nothing was started, replacing the previous false `'pending'`.
 */
export function buildHistoricalBackfillDispatchStamp(args: {
  provider: ImportProvider
  now: Date
}): HistoricalBackfillStamp {
  if (!providerSupportsHistoricalBackfill(args.provider)) {
    return {
      historicalBackfillStatus: 'unsupported',
      historicalBackfillDurable: false,
      historicalBackfillStartedAt: null,
      historicalBackfillStaleAfter: null,
      historicalBackfillError: null,
    }
  }

  return {
    historicalBackfillStatus: 'pending',
    historicalBackfillDurable: false,
    historicalBackfillStartedAt: args.now.toISOString(),
    historicalBackfillStaleAfter: new Date(
      args.now.getTime() + HISTORICAL_BACKFILL_STALE_AFTER_MS,
    ).toISOString(),
    historicalBackfillError: null,
  }
}

/** Settings patch for a dispatch that threw before any async work was accepted. */
export function buildHistoricalBackfillFailureStamp(args: {
  error: unknown
}): Pick<HistoricalBackfillStamp, 'historicalBackfillStatus' | 'historicalBackfillError'> & {
  historicalBackfillStaleAfter: null
} {
  return {
    historicalBackfillStatus: 'failed',
    historicalBackfillError:
      args.error instanceof Error ? args.error.message : String(args.error ?? 'unknown'),
    historicalBackfillStaleAfter: null,
  }
}

/**
 * Derive the state a reader should act on.
 *
 * The important branch: a `pending` record whose `historicalBackfillStaleAfter` has passed
 * resolves to `'stale'`, not `'pending'` — so a backfill killed mid-flight is reported as
 * needing retry instead of appearing to still be running.
 *
 * A `pending` record with NO deadline (written before this module existed) is also treated
 * as stale once it is older than the window, so pre-existing rows converge on the truth
 * without a migration.
 */
export function resolveHistoricalBackfillState(
  settings: Record<string, unknown> | null | undefined,
  now: Date,
): HistoricalBackfillDerivedState {
  const s = settings ?? {}
  const status = typeof s.historicalBackfillStatus === 'string' ? s.historicalBackfillStatus : null

  if (status === 'complete') return 'complete'
  if (status === 'failed') return 'failed'
  if (status === 'unsupported') return 'unsupported'
  if (status !== 'pending') return 'unknown'

  const deadline = parseIsoDate(s.historicalBackfillStaleAfter)
  if (deadline) {
    return now.getTime() > deadline.getTime() ? 'stale' : 'pending'
  }

  // Legacy row with no deadline — fall back to the start time plus the same window.
  const startedAt = parseIsoDate(s.historicalBackfillStartedAt)
  if (startedAt) {
    return now.getTime() > startedAt.getTime() + HISTORICAL_BACKFILL_STALE_AFTER_MS
      ? 'stale'
      : 'pending'
  }

  // `pending` with no timestamps at all cannot be shown to be running; it is not evidence
  // of active work, so report it as stale (recoverable) rather than in-progress.
  return 'stale'
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
