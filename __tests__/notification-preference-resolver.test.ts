import { describe, expect, it } from "vitest"
import {
  getDefaultNotificationPreferences,
  getNotificationPreferencesFingerprint,
  resolveNotificationPreferences,
  NOTIFICATION_CATEGORY_IDS,
} from "@/lib/notification-settings"

describe("notification preference resolver", () => {
  it("fills missing categories with defaults", () => {
    const resolved = resolveNotificationPreferences({
      globalEnabled: true,
      categories: {
        chat_mentions: { enabled: true, inApp: true, email: false, sms: false },
      },
    })

    expect(Object.keys(resolved.categories ?? {})).toHaveLength(NOTIFICATION_CATEGORY_IDS.length)
    expect(resolved.categories?.chat_mentions).toEqual({
      enabled: true,
      inApp: true,
      email: false,
      sms: false,
      // No saved push switch: it follows in-app, which is how push worked before it had one.
      push: true,
    })
    expect(resolved.categories?.lineup_reminders?.enabled).toBe(true)
  })

  it("creates stable fingerprints and changes on preference change", () => {
    const defaults = getDefaultNotificationPreferences()
    const fingerprintA = getNotificationPreferencesFingerprint(defaults)
    const fingerprintB = getNotificationPreferencesFingerprint(defaults)
    expect(fingerprintA).toBe(fingerprintB)

    const changed = {
      ...defaults,
      categories: {
        ...defaults.categories,
        ai_alerts: {
          ...(defaults.categories?.ai_alerts ?? { enabled: true, inApp: true, email: true, sms: false }),
          email: false,
        },
      },
    }
    const fingerprintChanged = getNotificationPreferencesFingerprint(changed)
    expect(fingerprintChanged).not.toBe(fingerprintA)
  })
})
