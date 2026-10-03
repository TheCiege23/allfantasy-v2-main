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

describe("fingerprint covers quiet hours and league overrides (2026-10-02)", () => {
  const base = getDefaultNotificationPreferences()
  const fp = getNotificationPreferencesFingerprint

  it("changes when quiet hours are switched on or moved", () => {
    const on = { ...base, quietHours: { enabled: true, startHour: 22, endHour: 7 } }
    expect(fp(on)).not.toBe(fp(base))
    expect(fp({ ...on, quietHours: { enabled: true, startHour: 23, endHour: 7 } })).not.toBe(fp(on))
  })

  it("treats a switched-off window as no window", () => {
    expect(fp({ ...base, quietHours: { enabled: false, startHour: 22, endHour: 7 } })).toBe(fp(base))
  })

  it("changes when a league is muted, and not for a no-opinion override", () => {
    const muted = { ...base, leagues: { L1: { enabled: false } } }
    expect(fp(muted)).not.toBe(fp(base))
    expect(fp({ ...base, leagues: { L1: {} } })).toBe(fp(base))
    expect(fp({ ...base, leagues: { L1: { mutedCategories: ["trade_proposals" as const] } } })).not.toBe(fp(base))
  })

  it("does not depend on league order", () => {
    const a = { ...base, leagues: { L1: { enabled: false }, L2: { enabled: false } } }
    const b = { ...base, leagues: { L2: { enabled: false }, L1: { enabled: false } } }
    expect(fp(a)).toBe(fp(b))
  })
})
