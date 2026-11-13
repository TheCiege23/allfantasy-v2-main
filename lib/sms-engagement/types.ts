/**
 * SMS Engagement System (PROMPT 303) — types for critical alerts.
 * Draft alerts, trade alerts, matchup reminders.
 */

/** Draft alert types for SMS. */
export type DraftAlertType =
  | "on_the_clock"
  | "timer_warning"
  | "draft_starting_soon"
  | "auto_pick"
  | "queue_player_taken"
  | "trade_offer"
  | "paused"
  | "resumed"

/** Trade alert types. */
export type TradeAlertType = "proposal" | "accepted" | "rejected"

/** Matchup reminder types. */
export type MatchupReminderType =
  | "lineup_lock_soon"
  | "lineup_locked"
  | "matchup_result"
  | "matchup_reminder"

/** Result of sending one SMS. */
export interface SmsSendResult {
  ok: boolean
  userId: string
  error?: string
}
