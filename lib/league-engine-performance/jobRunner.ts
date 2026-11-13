/**
 * Timed execution helpers for league-engine paths (API routes, workers, cron).
 * Pairs with BullMQ `enqueueLeagueEngineJob` for durable work; use this for observability on hot paths.
 */

import 'server-only'

import {
  createEngineTimer,
  logLeagueEngineEvent,
  type LeagueEngineSubsystem,
} from '@/lib/league-engine-performance/observability'

type TimedEngineOperationOptions = {
  subsystem: LeagueEngineSubsystem
  action: string
  leagueId?: string
  idempotencyKey?: string
  jobId?: string
  /** When set, log a warning if elapsed ms exceeds this threshold (slow path awareness). */
  slowThresholdMs?: number
}

/**
 * Runs `fn`, logs duration + success/failure with structured JSON (log aggregators).
 */
export async function withLeagueEngineTimedOperation<T>(
  opts: TimedEngineOperationOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const timer = createEngineTimer()
  try {
    const result = await fn()
    const durationMs = timer.elapsedMs()
    const slow =
      opts.slowThresholdMs != null && durationMs > opts.slowThresholdMs ? opts.slowThresholdMs : undefined
    logLeagueEngineEvent({
      subsystem: opts.subsystem,
      action: opts.action,
      leagueId: opts.leagueId,
      durationMs,
      idempotencyKey: opts.idempotencyKey,
      jobId: opts.jobId,
      ok: true,
      extra: slow != null ? { slowThresholdMs: slow } : undefined,
    })
    return result
  } catch (e) {
    const durationMs = timer.elapsedMs()
    const message = e instanceof Error ? e.message : String(e)
    logLeagueEngineEvent({
      subsystem: opts.subsystem,
      action: opts.action,
      leagueId: opts.leagueId,
      durationMs,
      idempotencyKey: opts.idempotencyKey,
      jobId: opts.jobId,
      ok: false,
      error: message,
    })
    throw e
  }
}
