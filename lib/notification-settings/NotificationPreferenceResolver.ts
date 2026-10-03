import type {
  NotificationPreferences,
  NotificationCategoryId,
  NotificationChannelPrefs,
} from "./types"
import {
  NOTIFICATION_CATEGORY_IDS,
  OPT_IN_NOTIFICATION_CATEGORY_IDS,
  SMS_DEFAULT_ON_AFTER_CONSENT_CATEGORY_IDS,
} from "./types"
import { readSmsConsent } from "@/lib/sms/smsConsent"

const DEFAULT_CHANNEL: NotificationChannelPrefs = {
  enabled: true,
  inApp: true,
  email: true,
  sms: false,
  push: true,
}

/** An opt-in category's default: off everywhere until the user turns it on. */
const OPT_IN_CHANNEL: NotificationChannelPrefs = {
  enabled: false,
  inApp: false,
  email: false,
  sms: false,
  push: false,
}

/**
 * The default for ONE category. Almost every category shares DEFAULT_CHANNEL; the opt-in ones
 * (`OPT_IN_NOTIFICATION_CATEGORY_IDS`, today only league chat) start off on every channel.
 *
 * ⚠ THIS IS ALSO THE FALLBACK FOR A PARTIALLY SAVED ROW, not just a missing one — `resolve…`
 * below reads `defaults.categories[id]` field by field. So an opt-in category saved as
 * `{ enabled: true }` alone does NOT silently switch its email on: absent channels stay off.
 */
export function getDefaultCategoryPreferences(
  id: NotificationCategoryId,
  opts: { smsConsented?: boolean } = {},
): NotificationChannelPrefs {
  if (OPT_IN_NOTIFICATION_CATEGORY_IDS.includes(id)) return { ...OPT_IN_CHANNEL }
  return { ...DEFAULT_CHANNEL, sms: Boolean(opts.smsConsented) && SMS_DEFAULT_ON_AFTER_CONSENT_CATEGORY_IDS.includes(id) }
}

/**
 * Has this preferences blob a LIVE SMS consent record (agreed, not withdrawn)? It flips the SMS
 * DEFAULT for the time-sensitive categories. It is read from the same JSON the resolver is given,
 * so every caller agrees without threading a flag through.
 *
 * ⚠ This decides a default, never a send. The dispatcher still requires `hasSmsConsent` against
 * the CURRENT phone number (consent is per number), a verified phone and the daily cap; a stale
 * record for an old number can therefore flip a switch on screen but cannot text anyone.
 */
export function hasLiveSmsConsentRecord(saved: unknown): boolean {
  const record = readSmsConsent(saved)
  return Boolean(record?.consentedAt) && !record?.revokedAt
}

/**
 * Returns default preferences: every category enabled with in-app + push + email and no SMS,
 * except the opt-in categories, which start off on every channel.
 */
export function getDefaultNotificationPreferences(opts: { smsConsented?: boolean } = {}): NotificationPreferences {
  const categories: Partial<Record<NotificationCategoryId, NotificationChannelPrefs>> = {}
  for (const id of NOTIFICATION_CATEGORY_IDS) {
    categories[id] = getDefaultCategoryPreferences(id, opts)
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
  const defaults = getDefaultNotificationPreferences({ smsConsented: hasLiveSmsConsentRecord(saved) })
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
    const value = resolved.categories?.[id] ?? getDefaultCategoryPreferences(id)
    const push = value.push ?? value.inApp
    return `${id}:${value.enabled ? "1" : "0"}${value.inApp ? "1" : "0"}${value.email ? "1" : "0"}${value.sms ? "1" : "0"}${push ? "1" : "0"}`
  })
  /*
   * ⚠ QUIET HOURS AND LEAGUE OVERRIDES ARE PART OF THE STATE. The "updated elsewhere" banner compares
   * this string; before 2026-10-02 it covered only the switch and the categories, so a quiet-hours
   * window or a league mute changed on another device was never noticed — and the stale draft on
   * screen then saved over it.
   *
   * Canonical on purpose: a league override with no opinion (`{}`, what "Follow my settings" and
   * Reset write) prints the same as an absent one, and leagues are sorted, so two equivalent states
   * cannot raise a false "updated elsewhere".
   */
  const q = resolved.quietHours
  // A window switched off is the same state as no window at all.
  const quiet =
    q && q.enabled !== false ? `q:${q.startHour}-${q.endHour}${q.allowCritical === false ? "c0" : "c1"}` : "q:off"
  const leagues = Object.entries(resolved.leagues ?? {})
    .map(([id, o]) => {
      const muted = [...(o?.mutedCategories ?? [])].sort().join(",")
      const off = o?.enabled === false
      return off || muted ? `${id}:${off ? "0" : "1"}:${muted}` : null
    })
    .filter((x): x is string => x !== null)
    .sort()
  return `${resolved.globalEnabled !== false ? "1" : "0"}|${categories.join("|")}|${quiet}|L:${leagues.join(";")}`
}
