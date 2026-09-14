import type {
  NotificationPreferences,
  NotificationCategoryId,
  NotificationChannelPrefs,
} from "./types"
import { NOTIFICATION_CATEGORY_IDS } from "./types"

const DEFAULT_CHANNEL: NotificationChannelPrefs = {
  enabled: true,
  inApp: true,
  email: true,
  sms: false,
  push: true,
}

/**
 * Returns default preferences (all categories enabled, in-app + push + email, no SMS).
 */
export function getDefaultNotificationPreferences(): NotificationPreferences {
  const categories: Partial<Record<NotificationCategoryId, NotificationChannelPrefs>> = {}
  for (const id of NOTIFICATION_CATEGORY_IDS) {
    categories[id] = { ...DEFAULT_CHANNEL }
  }
  return { globalEnabled: true, categories }
}

/**
 * Merges saved preferences with defaults; missing categories get defaults.
 *
 * 🛑 IT MUST CARRY THROUGH KEYS IT DOES NOT INTERPRET. This function used to `return
 * { globalEnabled, categories }`, rebuilding a fresh object and silently discarding
 * everything else the caller had saved. That is not a cosmetic loss: `NotificationDispatcher`
 * reads `prefs.quietHours` and `prefs.leagues` off THIS function's output, so both
 * features would have been permanently `undefined` no matter what the user stored —
 * the settings would save correctly, read back empty, and never fire.
 *
 * ⚠ The failure is invisible from either end. The write path merges properly, the JSON
 * column really does contain the value, and a source-level check that the dispatcher
 * calls the right helpers still passes. Only reading a saved preference back through
 * here shows it gone. Add a key to `NotificationPreferences` and you must add it below.
 */
export function resolveNotificationPreferences(
  saved: NotificationPreferences | null | undefined
): NotificationPreferences {
  const defaults = getDefaultNotificationPreferences()
  // Preserved on BOTH return paths — the early return dropped them too.
  const passthrough: Partial<NotificationPreferences> = {
    ...(saved?.quietHours !== undefined && { quietHours: saved.quietHours }),
    ...(saved?.leagues !== undefined && { leagues: saved.leagues }),
  }
  if (!saved?.categories) return { ...defaults, ...passthrough }
  const categories = { ...defaults.categories }
  for (const id of NOTIFICATION_CATEGORY_IDS) {
    const s = saved.categories[id]
    if (s) {
      const inApp = s.inApp ?? defaults.categories?.[id]?.inApp ?? true
      categories[id] = {
        enabled: s.enabled ?? defaults.categories?.[id]?.enabled ?? true,
        inApp,
        email: s.email ?? defaults.categories?.[id]?.email ?? true,
        sms: s.sms ?? defaults.categories?.[id]?.sms ?? false,
        /*
         * ⚠ ABSENT PUSH FOLLOWS THIS ROW'S inApp, NOT THE DEFAULT. Push had no switch before
         * 2026-09-14 and simply followed in-app, so a row saved with in-app off has been
         * push-silent all along. Defaulting it to true would start buzzing exactly the people
         * who had turned this category's alerts down.
         */
        push: s.push ?? inApp,
      }
    }
  }
  return {
    globalEnabled: saved.globalEnabled ?? true,
    categories,
    ...passthrough,
  }
}

/**
 * Stable fingerprint for comparing preference snapshots in the client.
 */
export function getNotificationPreferencesFingerprint(
  prefs: NotificationPreferences | null | undefined
): string {
  const resolved = resolveNotificationPreferences(prefs)
  const categories = NOTIFICATION_CATEGORY_IDS.map((id) => {
    const value = resolved.categories?.[id] ?? DEFAULT_CHANNEL
    const push = value.push ?? value.inApp
    return `${id}:${value.enabled ? "1" : "0"}${value.inApp ? "1" : "0"}${value.email ? "1" : "0"}${value.sms ? "1" : "0"}${push ? "1" : "0"}`
  })
  return `${resolved.globalEnabled !== false ? "1" : "0"}|${categories.join("|")}`
}
