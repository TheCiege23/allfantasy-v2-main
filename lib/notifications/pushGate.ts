import "server-only"

import { getSettingsProfile } from "@/lib/user-settings"
import { resolveNotificationPreferences } from "@/lib/notification-settings/NotificationPreferenceResolver"
import type { NotificationCategoryId, NotificationPreferences } from "@/lib/notification-settings/types"
import { isPushCategory } from "@/lib/push-notifications/categories"
import { isCategoryAllowedForLeague } from "./leagueOverrides"
import { quietHoursSuppression } from "./quietHours"

/**
 * May this push reach this user's phone? ONE rule, used by the dispatcher and by every
 * caller that sends a push directly.
 *
 * 🛑 WHY IT EXISTS. The push service checks nothing but the device subscription. Two live
 * senders called it directly — the injured-starter sweep (`/api/cron/alert-sweep`, 193
 * chimmy_alert rows in the 30 days to 2026-09-14) and the trade sweep
 * (`tradeNotifyService`). So a user who switched injury or trade alerts off, muted the
 * league, or set quiet hours got the bell entry and the email withheld by the dispatcher,
 * and the phone buzzed anyway. A switch that only some senders read is worse than no
 * switch: the user is told they chose, and the phone disagrees.
 *
 * Checks, in order, each with a reason a caller can log:
 *   account switch -> category on -> push-capable category -> the category's push switch
 *   -> league not muted -> outside quiet hours (high severity passes only with allowCritical)
 *
 * ⚠ THE ACCOUNT SWITCH IS READ RAW AS WELL AS RESOLVED. The resolver's no-categories path
 * returns defaults and so reports `globalEnabled: true` for a row that says false (see
 * settingsNavBadges.ts). A push must never be the thing that ignores "notifications off".
 */

export type PushBlockReason =
  | "no_profile"
  | "global_off"
  | "category_off"
  | "not_push_category"
  | "push_off"
  | "league_muted"
  | "quiet_hours"

export type PushDecision = { allowed: true } | { allowed: false; reason: PushBlockReason }

export type PushDecisionInput = {
  category: NotificationCategoryId
  /** The League id the alert is about; null for an account-wide alert. */
  leagueId?: string | null
  severity: "low" | "medium" | "high"
  now?: Date
}

const blocked = (reason: PushBlockReason): PushDecision => ({ allowed: false, reason })

export function decidePush(
  saved: NotificationPreferences | null | undefined,
  input: PushDecisionInput & { fallbackTimezone?: string | null },
): PushDecision {
  if (saved?.globalEnabled === false) return blocked("global_off")
  const prefs = resolveNotificationPreferences(saved)
  if (prefs.globalEnabled === false) return blocked("global_off")

  const cat = prefs.categories?.[input.category]
  if (!cat?.enabled) return blocked("category_off")
  if (!isPushCategory(input.category)) return blocked("not_push_category")
  if (!(cat.push ?? cat.inApp)) return blocked("push_off")

  if (!isCategoryAllowedForLeague(prefs, input.category, input.leagueId ?? null)) {
    return blocked("league_muted")
  }

  const quiet = quietHoursSuppression(
    prefs.quietHours,
    input.now ?? new Date(),
    input.severity,
    input.fallbackTimezone,
  )
  if (quiet.push) return blocked("quiet_hours")

  return { allowed: true }
}

/** Loads the user's settings and decides. Callers treat a throw as "do not send". */
export async function decidePushForUser(userId: string, input: PushDecisionInput): Promise<PushDecision> {
  const profile = await getSettingsProfile(userId)
  if (!profile) return blocked("no_profile")
  return decidePush(profile.notificationPreferences as NotificationPreferences | null, {
    ...input,
    fallbackTimezone: profile.timezone,
  })
}
