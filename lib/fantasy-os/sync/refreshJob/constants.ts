/**
 * Fantasy OS — durable Sleeper current-state refresh JOB (Launch Batch 2 · B6, DB-first).
 *
 * A manual resync no longer runs inline on the browser request; it enqueues an `AutomationJob`
 * (the repo's existing DB-backed, idempotency-keyed job engine — NOT a new job system) that a durable
 * cron worker drains out-of-band. These constants are the single source of truth for the job type and
 * the enqueue guards shared by the enqueue service, the drain cron, and the status endpoint.
 */

/** AutomationJob.jobType for a user-initiated Sleeper current-state refresh. */
export const SLEEPER_REFRESH_JOB_TYPE = 'sleeper.currentStateRefresh'

/** Min interval between SUCCESSFUL refreshes of one league — the cooldown / soft quota. Only advances
 *  on success (LeagueSyncState.lastSuccessfulSyncAt), so a failed job never consumes the allowance. */
export const SLEEPER_REFRESH_COOLDOWN_MS = 60_000

/** Idempotency time-bucket so duplicate clicks within the same window collapse to ONE job. */
export const SLEEPER_REFRESH_IDEMPOTENCY_BUCKET_MS = 60_000

/** Max concurrent (queued|running) manual refresh jobs a single user may hold. */
export const SLEEPER_REFRESH_MAX_INFLIGHT_PER_USER = 5

/** Deterministic idempotency key: duplicate clicks in one bucket → one job; a later bucket → a new job. */
export function sleeperRefreshIdempotencyKey(runKey: string, nowMs: number): string {
  return `sleeper-refresh:${runKey}:${Math.floor(nowMs / SLEEPER_REFRESH_IDEMPOTENCY_BUCKET_MS)}`
}

/** Prefix used to find any job for a run key across buckets (in-flight dedup + status lookup). */
export function sleeperRefreshIdempotencyPrefix(runKey: string): string {
  return `sleeper-refresh:${runKey}:`
}
