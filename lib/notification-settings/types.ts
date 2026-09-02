/**
 * Notification preference per category: enabled + delivery channels.
 */

export type NotificationCategoryId =
  | "lineup_reminders"
  | "matchup_results"
  | "waiver_processing"
  | "trade_proposals"
  | "trade_accept_reject"
  | "chat_mentions"
  | "league_announcements"
  | "bracket_updates"
  | "ai_alerts"
  | "league_drama"
  | "commissioner_alerts"
  | "system_account"
  | "injury_alerts"
  | "performance_alerts"
  | "lineup_alerts"
  | "draft_alerts"
  | "draft_intel_alerts"
  | "autocoach"

export interface NotificationChannelPrefs {
  enabled: boolean
  inApp: boolean
  email: boolean
  sms: boolean
}

/**
 * Per-league override. Global settings are the default; a league may opt out entirely
 * or mute individual categories.
 *
 * ⚠ AN ABSENT ENTRY MEANS "FOLLOW THE GLOBAL SETTING", NOT "OFF". Every existing row
 * predates this field, so treating absence as a decision would silence every league in
 * the product on deploy. `undefined` and `{}` must both inherit.
 */
export interface LeagueNotificationOverride {
  /** false silences this league entirely. Absent = follow global. */
  enabled?: boolean
  /** Categories muted for THIS league only. Absent = follow global. */
  mutedCategories?: NotificationCategoryId[]
}

export interface NotificationPreferences {
  globalEnabled?: boolean
  categories?: Partial<Record<NotificationCategoryId, NotificationChannelPrefs>>
  /**
   * Quiet hours, evaluated in the user's timezone by `lib/notifications/quietHours.ts`.
   * Suppresses push and SMS only — the in-app row is a log and still gets written.
   */
  quietHours?: {
    startHour: number
    endHour: number
    timezone?: string | null
    allowCritical?: boolean
    enabled?: boolean
  }
  /**
   * Per-league overrides, keyed by League id.
   *
   * ⚠ STORED IN THE EXISTING `UserProfile.notificationPreferences` JSON ON PURPOSE.
   * A dedicated column or join table would be a schema change, and a migration is not
   * pushable work in this repo — it is a separate decision that belongs to the account
   * owner. This shape needs no migration and no backfill, because absence inherits.
   */
  leagues?: Record<string, LeagueNotificationOverride>
}

export const NOTIFICATION_CATEGORY_IDS: NotificationCategoryId[] = [
  "lineup_reminders",
  "matchup_results",
  "waiver_processing",
  "trade_proposals",
  "trade_accept_reject",
  "chat_mentions",
  "league_announcements",
  "bracket_updates",
  "ai_alerts",
  "league_drama",
  "commissioner_alerts",
  "system_account",
  "injury_alerts",
  "performance_alerts",
  "lineup_alerts",
  "draft_alerts",
  "draft_intel_alerts",
  "autocoach",
]

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategoryId, string> = {
  lineup_reminders: "Lineup reminders",
  matchup_results: "Matchup results",
  waiver_processing: "Waiver processing",
  trade_proposals: "Trade proposals",
  trade_accept_reject: "Trade accept / reject",
  chat_mentions: "Chat mentions",
  league_announcements: "League announcements & @all",
  bracket_updates: "Bracket updates",
  ai_alerts: "AI alerts",
  league_drama: "League drama / storylines",
  commissioner_alerts: "Commissioner alerts",
  system_account: "System & account alerts",
  injury_alerts: "Player injury alerts",
  performance_alerts: "Game performance alerts",
  lineup_alerts: "Starting lineup alerts",
  draft_alerts: "Draft alerts (on the clock, timer, trade offers)",
  draft_intel_alerts: "Draft intelligence (AI queue, Chimmy DMs, recap)",
  autocoach: "Chimmy AutoCoach lineup swaps",
}
