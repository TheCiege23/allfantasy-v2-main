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
  /*
   * 🛑 `draft_alerts` WAS MISSING WHILE `draft_intel_alerts` WAS PRESENT, WHICH IS THE WORST
   * ARRANGEMENT OF THE TWO. `DraftNotificationService.resolveCategoryForEvent` sends everything
   * that is not an AI-intelligence event — ON THE CLOCK included, plus the pick timer, pause /
   * resume, slow-draft and commissioner events — to `draft_alerts`. So the ONE draft alert
   * people actually need their phone to buzz for could never reach the push transport, however
   * completely they had opted in, while Chimmy's draft-recap DM could.
   *
   * The category itself was never the problem: it is a real `NotificationCategoryId` with a
   * label and a settings toggle ("Draft alerts (on the clock, timer, trade offers)"), so a user
   * turning it on saw a switch that governed in-app and email and silently did nothing for
   * push. Opt-in, authentication, effective preferences and quiet hours are unchanged — this
   * only stops the dispatcher discarding the category before any of them are consulted.
   */
  "draft_alerts",
  "draft_intel_alerts",
  "autocoach",
  "injury_alerts",
  "trade_proposals",
  "trade_accept_reject",
  // A player you follow (2026-09-14): the whole point of following is being told.
  "followed_players",
] as const

export type PushNotificationCategory = (typeof PUSH_NOTIFICATION_CATEGORIES)[number]

export function isPushCategory(category: string): category is PushNotificationCategory {
  return (PUSH_NOTIFICATION_CATEGORIES as readonly string[]).includes(category)
}
