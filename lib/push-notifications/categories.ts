/**
 * Categories that may send a browser push when the user has subscribed.
 *
 * ⚠ ITS OWN MODULE SO A CLIENT COMPONENT CAN READ IT. `./index.ts` re-exports the push
 * service (prisma, web-push). The settings screen needs this list to decide whether to
 * draw a Push switch, and importing the index there would pull the server sender into
 * the browser bundle. The index re-exports from here, so existing imports are unchanged.
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
  // A player you follow (2026-09-14): the whole point of following is being told.
  "followed_players",
  // Someone messaged you (2026-09-25). Without these the dispatcher drops the push before the
  // category's own push switch is ever read, however the rest of the path is built.
  "direct_messages",
  // Opt-in and off by default; push only fires for someone who switched it on.
  "league_chat",
] as const

export type PushNotificationCategory = (typeof PUSH_NOTIFICATION_CATEGORIES)[number]

export function isPushCategory(category: string): category is PushNotificationCategory {
  return (PUSH_NOTIFICATION_CATEGORIES as readonly string[]).includes(category)
}
