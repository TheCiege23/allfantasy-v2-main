/**
 * Phase 5G — Draft health / automation observability event IDs.
 * Logged as `logStructured(level, 'draft_health', <eventId>, meta)` (see `emitDraftHealth`).
 * Other subsystems may add `draftEvent: DraftHealthEventId` on their own `source` for aggregation.
 */

export const DRAFT_HEALTH_SOURCE = 'draft_health' as const

/** Stable string union for drains / dashboards (no PII in event names). */
export type DraftHealthEventId =
  | 'draft_cron_batch_started'
  | 'draft_cron_batch_completed'
  | 'draft_expired_timer_processed'
  | 'draft_autopick_fired'
  | 'draft_autopick_skipped'
  | 'draft_lock_busy'
  | 'draft_queue_pick_used'
  | 'draft_bpa_fallback_used'
  | 'draft_auction_automation_processed'
  | 'draft_live_sync_snapshot_failed'
  | 'draft_session_slot_order_repaired'
  | 'draft_pick_stale_overall'
  | 'legacy_draft_route_blocked'
  | 'chimmy_legacy_draft_signal_fallback'
