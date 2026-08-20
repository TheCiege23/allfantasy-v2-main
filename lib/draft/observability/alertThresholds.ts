/**
 * Phase 5G — Documentation-only alert thresholds for future paging / dashboards.
 * No provider wiring yet; ops can grep Vercel logs for `source":"draft_health"`.
 */

/** Any sustained `legacy_draft_route_blocked` in production suggests stale clients or scripts. */
export const ALERT_LEGACY_DRAFT_BLOCKED_MIN_TOTAL_PER_HOUR = 1

/** Cron route 500s or unhandled throws — investigate immediately. */
export const ALERT_DRAFT_CRON_ERROR_MIN_PER_RUN = 1

/** Many concurrent pick writers — tune lock TTL or reduce double-submits. */
export const ALERT_DRAFT_LOCK_BUSY_SPIKE_PER_BATCH = 5

/** Frequent slot-order repairs may indicate corrupt settings or migration issues. */
export const ALERT_SESSION_SLOT_REPAIR_SPIKE_PER_HOUR = 10

/** Snapshot build failures during poll — DB or resolver regressions. */
export const ALERT_LIVE_SYNC_FAILURE_MIN_PER_HOUR = 3

/** Chimmy still reading legacy DraftRoom — leagues missing canonical DraftSession. */
export const ALERT_CHIMMY_LEGACY_FALLBACK_SPIKE_PER_HOUR = 5

/** Client/server overall mismatch — UX or double-navigation. */
export const ALERT_STALE_OVERALL_SPIKE_PER_LEAGUE_PER_HOUR = 30
