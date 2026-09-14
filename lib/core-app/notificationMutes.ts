import type {
  LeagueNotificationOverride,
  NotificationCategoryId,
  NotificationPreferences,
} from '@/lib/notification-settings/types'
import { NOTIFICATION_CATEGORY_IDS } from '@/lib/notification-settings/types'
import { muteLeague, toggleCategory } from '@/lib/notification-settings/leagueOverrideEdits'

/**
 * "Mute this" from a row on the Core notifications screen.
 *
 * User decision, 2026-09-14: after every push was made to follow the user's settings
 * (pushGate), the next step is muting from where the noise is seen — one league's alerts
 * of one type, or the whole league — without a trip to /settings.
 *
 * ⚠ THE SAVE IS ONE LEAGUE'S ENTRY, NOT THE WHOLE PREFERENCES OBJECT. `/api/user/profile`
 * merges `notificationPreferences` one level deep, so `{ leagues: { [id]: entry } }`
 * replaces exactly that league and leaves every other league, every category switch,
 * quiet hours and the keys other features keep in the same column as they are stored —
 * even if another tab changed them after this screen loaded. Sending the full object read
 * a moment earlier would write that moment's copy back over them.
 *
 * ⚠ UNDO RESTORES THE PREVIOUS ENTRY EXACTLY, and `{}` when there was none. `{}` is
 * "follow the global setting" by design (leagueOverrides.ts), and a deleted key would be
 * restored by the same one-level merge — see leagueOverrideEdits.ts.
 */

export type RowMute = { kind: 'category'; category: NotificationCategoryId } | { kind: 'league' }

export type LeagueOverridePatch = { leagues: Record<string, LeagueNotificationOverride> }

/** The category the dispatcher stamped on a stored notification, when it is a real one. */
export function categoryFromMeta(meta: unknown): NotificationCategoryId | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const value = (meta as Record<string, unknown>).notificationCategory
  return typeof value === 'string' && (NOTIFICATION_CATEGORY_IDS as string[]).includes(value)
    ? (value as NotificationCategoryId)
    : null
}

export function rowMuteEdit(
  saved: NotificationPreferences | null | undefined,
  leagueId: string,
  mute: RowMute,
): { patch: LeagueOverridePatch; undo: LeagueOverridePatch } {
  const prefs = saved ?? {}
  const previous = prefs.leagues?.[leagueId]
  const next =
    mute.kind === 'league' ? muteLeague(prefs, leagueId) : toggleCategory(prefs, leagueId, mute.category, true)
  return {
    patch: { leagues: { [leagueId]: next.leagues?.[leagueId] ?? {} } },
    undo: { leagues: { [leagueId]: previous ?? {} } },
  }
}
