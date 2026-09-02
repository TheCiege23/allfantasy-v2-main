import type {
  NotificationCategoryId,
  NotificationPreferences,
} from "@/lib/notification-settings/types"

/**
 * The three edits the per-league override UI can make, as pure functions.
 *
 * They live here rather than inside `LeagueNotificationOverridesCard` so the round-trip
 * test can drive the REAL edit through the REAL server merge. A test that rebuilds these
 * objects by hand would prove only that the test agrees with itself.
 *
 * 🛑 EVERY "NO OPINION" RESULT IS `{}`, NEVER A DELETED KEY. The save path is
 * `/api/user/profile` → `mergeNotificationPreferences`, which merges one level deep and so
 * computes `leagues = { ...stored, ...incoming }`. A key removed here is restored from
 * `stored` on the way in: the UI shows the override cleared, the request succeeds, and the
 * old value is still there on the next load. `{}` overwrites at the league-id level because
 * the merge stops after one level, and `lib/notifications/leagueOverrides.ts` treats `{}`
 * as inherit by design.
 */

/** Stop overriding: fall back to the global answer. */
export function followGlobal(
  prefs: NotificationPreferences,
  leagueId: string,
): NotificationPreferences {
  return { ...prefs, leagues: { ...(prefs.leagues ?? {}), [leagueId]: {} } }
}

/** Silence one league entirely, leaving the rest of the account alone. */
export function muteLeague(
  prefs: NotificationPreferences,
  leagueId: string,
): NotificationPreferences {
  const current = prefs.leagues?.[leagueId] ?? {}
  return {
    ...prefs,
    leagues: { ...(prefs.leagues ?? {}), [leagueId]: { ...current, enabled: false } },
  }
}

/** Mute or unmute a single category for one league. */
export function toggleCategory(
  prefs: NotificationPreferences,
  leagueId: string,
  category: NotificationCategoryId,
  muted: boolean,
): NotificationPreferences {
  const current = prefs.leagues?.[leagueId] ?? {}
  const set = new Set(current.mutedCategories ?? [])
  if (muted) set.add(category)
  else set.delete(category)
  const mutedCategories = Array.from(set)

  const nextLeagues = { ...(prefs.leagues ?? {}) }
  /*
   * No opinion left on this league. ⚠ Unlike `followGlobal`, this `{}` is TIDINESS, not a
   * guard — measured, not assumed: replacing this whole branch with the plain
   * `{ ...current, mutedCategories }` leaves the suite green, because `{ mutedCategories: [] }`
   * and `{}` are indistinguishable to the resolver and to `customisedLeagueIds`. It is here
   * so the stored JSON does not accumulate empty arrays, and nothing depends on it.
   * `followGlobal`'s `{}` IS load-bearing and has a failing control to prove it.
   */
  nextLeagues[leagueId] =
    mutedCategories.length === 0 && current.enabled !== false
      ? {}
      : { ...current, mutedCategories }

  return { ...prefs, leagues: nextLeagues }
}
