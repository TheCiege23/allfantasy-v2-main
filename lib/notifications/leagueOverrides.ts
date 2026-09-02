import type {
  LeagueNotificationOverride,
  NotificationCategoryId,
  NotificationPreferences,
} from "@/lib/notification-settings/types"

/**
 * Per-league notification overrides, layered on top of the global settings.
 *
 * 🛑 ABSENCE INHERITS. IT DOES NOT MEAN "OFF". Every `notificationPreferences` row in
 * production predates this feature and has no `leagues` key at all, so a resolver that
 * treated a missing entry as a decision would silence every league in the product the
 * moment it deployed — and silently, because nothing errors when a notification is
 * simply not sent. `undefined`, `{}`, and an entry with no `enabled` field must all
 * fall through to the global answer.
 *
 * ⚠ AND A GLOBAL "OFF" IS NOT OVERRIDABLE UPWARD. A league override can only ever be
 * more restrictive than the global setting. If someone has switched notifications off
 * globally, a stale per-league `enabled: true` must not resurrect them — that would
 * turn the master switch into a suggestion.
 */

export function getLeagueOverride(
  prefs: NotificationPreferences | null | undefined,
  leagueId: string | null | undefined,
): LeagueNotificationOverride | undefined {
  if (!prefs?.leagues || !leagueId) return undefined
  return prefs.leagues[leagueId]
}

/**
 * Should this category reach this user, for this league?
 *
 * Order matters: the global switch is checked first and cannot be overridden upward.
 */
export function isCategoryAllowedForLeague(
  prefs: NotificationPreferences | null | undefined,
  category: NotificationCategoryId,
  leagueId: string | null | undefined,
): boolean {
  // The master switch wins. A per-league opt-in cannot re-enable a globally-off account.
  if (prefs?.globalEnabled === false) return false

  const override = getLeagueOverride(prefs, leagueId)
  if (!override) return true

  if (override.enabled === false) return false
  if (override.mutedCategories?.includes(category)) return false
  return true
}

/**
 * Convenience for settings UIs: the leagues this user has explicitly customised.
 * Leagues absent from this list are on the global default, which is the intended
 * state for nearly everyone.
 */
export function customisedLeagueIds(
  prefs: NotificationPreferences | null | undefined,
): string[] {
  if (!prefs?.leagues) return []
  return Object.entries(prefs.leagues)
    .filter(([, v]) => v && (v.enabled === false || (v.mutedCategories?.length ?? 0) > 0))
    .map(([id]) => id)
}
