import { getDefaultNotificationPreferences } from "./NotificationPreferenceResolver"
import type { NotificationPreferences } from "./types"

/**
 * The payload Settings › Notifications sends for "Reset to defaults".
 *
 * ⚠ THE DEFAULTS ALONE DO NOT RESET. `getDefaultNotificationPreferences()` carries only
 * `globalEnabled` + `categories`, and the server merge keeps every stored key the payload omits
 * (`mergeNotificationPreferences`) — so quiet hours and per-league mutes looked cleared, survived the
 * save, and came back on refetch, still in force. A reset has to SEND neutral values:
 *
 *  - quiet hours explicitly off, with the stock 22→7 window;
 *  - `{}` for every league that has an override. `leagues: {}` on its own is not enough: the merge is
 *    one level deep, so `{ ...stored, ...{} }` keeps every stored league. `{}` per league is the same
 *    neutral value `LeagueNotificationOverridesCard` writes for "Follow my settings".
 *
 * `current` is the draft on screen, which `resolveNotificationPreferences` builds with `leagues`
 * passed through — so every stored league id is in it.
 */
export function buildResetNotificationPreferences(current: NotificationPreferences): NotificationPreferences {
  return {
    ...getDefaultNotificationPreferences(),
    quietHours: { enabled: false, startHour: 22, endHour: 7, allowCritical: true },
    leagues: Object.fromEntries(Object.keys(current.leagues ?? {}).map((leagueId) => [leagueId, {}])),
  }
}
