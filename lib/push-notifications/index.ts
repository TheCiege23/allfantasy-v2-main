/**
 * Push Notifications (PROMPT 304).
 * Web push for AI alerts, chat mentions, league updates.
 */

export * from "./types"
export {
  savePushSubscription,
  removePushSubscription,
  getPushSubscriptions,
  sendPushToUser,
} from "./push-service"

/**
 * Categories that trigger a browser push when the user has subscribed.
 *
 * ⚠ THE THREE AT THE BOTTOM WERE MISSING, AND THEY ARE THE ONES PEOPLE ASK
 * FOR. An injury to a starter and a trade landing are the two events a manager
 * actually wants their phone to buzz for, and both were absent here — so the
 * dispatcher filtered them out before push was ever considered, however
 * completely the rest of the stack was built.
 */
export const PUSH_NOTIFICATION_CATEGORIES = [
  "ai_alerts",
  "chat_mentions",
  "league_announcements",
  "matchup_results",
  "lineup_reminders",
  "league_drama",
  "commissioner_alerts",
  "draft_intel_alerts",
  "autocoach",
  "injury_alerts",
  "trade_proposals",
  "trade_accept_reject",
] as const

export type PushNotificationCategory = (typeof PUSH_NOTIFICATION_CATEGORIES)[number]

export function isPushCategory(category: string): category is PushNotificationCategory {
  return (PUSH_NOTIFICATION_CATEGORIES as readonly string[]).includes(category)
}
