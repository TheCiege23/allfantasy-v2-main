/**
 * SMS Engagement System (PROMPT 303) — types for critical alerts.
 * Draft alerts, trade alerts, matchup reminders.
 */

/** Result of sending one SMS. */
export interface SmsSendResult {
  ok: boolean
  userId: string
  error?: string
}
