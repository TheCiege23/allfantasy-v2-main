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
 * The affected leagues this category may still reach, out of the ones an event touches.
 *
 * 🛑 ONE EVENT CAN AFFECT SEVERAL LEAGUES, AND CHECKING ONLY THE FIRST GETS IT WRONG IN BOTH
 * DIRECTIONS. Player news is the case: one injury reaches a manager who rosters that player in
 * twelve leagues, and the blueprint requires ONE notification carrying all of them. Anchoring
 * that notification on `leagueIds[0]` and running the single-league gate against it means:
 *
 *   - the user muted the category in the anchor league only  → SILENCED for eleven leagues
 *     where they never muted anything;
 *   - the user muted it in eleven leagues but not the anchor → NOTIFIED as though they had
 *     muted nothing, with the muted leagues still listed in the detail view.
 *
 * The right unit is the SET. This returns the subset that survives, so a caller can drop the
 * muted leagues from the payload and skip the send entirely when none survive. An empty input
 * means "not league-scoped" and is answered by the global/category gates alone — it returns
 * `[]`, and callers must treat that as "no league filter applied", never as "everything muted".
 *
 * ⚠ THE MASTER SWITCH STILL WINS, exactly as in the single-league form: a globally-off account
 * yields an empty set no matter what any per-league entry says.
 */
export function allowedLeaguesForCategory(
  prefs: NotificationPreferences | null | undefined,
  category: NotificationCategoryId,
  leagueIds: readonly string[] | null | undefined,
): string[] {
  if (prefs?.globalEnabled === false) return []
  if (!leagueIds || leagueIds.length === 0) return []
  return leagueIds.filter((id) => isCategoryAllowedForLeague(prefs, category, id))
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
