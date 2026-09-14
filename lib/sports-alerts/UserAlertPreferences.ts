import { getSettingsProfile } from "@/lib/user-settings/SettingsQueryService"
import { updateUserProfile } from "@/lib/user-settings/UserProfileService"
import type { UserAlertPreferences } from "./types"
import type { NotificationPreferences, NotificationChannelPrefs } from "@/lib/notification-settings/types"

const CATEGORY_MAP: Record<keyof UserAlertPreferences, string> = {
  injuryAlerts: "injury_alerts",
  performanceAlerts: "performance_alerts",
  lineupAlerts: "lineup_alerts",
}

function toChannelPref(enabled: boolean, existing?: NotificationChannelPrefs): NotificationChannelPrefs {
  return {
    enabled,
    inApp: enabled,
    // Preserve email/SMS selections managed in full notification settings.
    email: existing?.email ?? false,
    sms: existing?.sms ?? false,
    /*
     * And the push switch (2026-09-14). Rebuilding the object without it would silently reset a
     * user's "no push for injuries" back to following in-app every time this toggle was saved.
     * Absent stays absent, so it keeps following in-app as before.
     */
    ...(existing?.push !== undefined && { push: existing.push }),
  }
}

/**
 * Resolve sports alert preferences from user profile notification preferences.
 */
export async function getAlertPreferences(userId: string): Promise<UserAlertPreferences> {
  const profile = await getSettingsProfile(userId)
  const prefs = (profile as { notificationPreferences?: NotificationPreferences } | null)
    ?.notificationPreferences?.categories ?? {}

  return {
    injuryAlerts: (prefs.injury_alerts?.enabled ?? true) && (prefs.injury_alerts?.inApp ?? true),
    performanceAlerts: (prefs.performance_alerts?.enabled ?? true) && (prefs.performance_alerts?.inApp ?? true),
    lineupAlerts: (prefs.lineup_alerts?.enabled ?? true) && (prefs.lineup_alerts?.inApp ?? true),
  }
}

/**
 * Persist sports alert preferences into user profile (notificationPreferences).
 */
export async function setAlertPreferences(
  userId: string,
  preferences: Partial<UserAlertPreferences>
): Promise<{ ok: boolean; error?: string }> {
  const current = await getAlertPreferences(userId)
  const merged: UserAlertPreferences = {
    injuryAlerts: preferences.injuryAlerts ?? current.injuryAlerts,
    performanceAlerts: preferences.performanceAlerts ?? current.performanceAlerts,
    lineupAlerts: preferences.lineupAlerts ?? current.lineupAlerts,
  }

  const categories: Partial<Record<string, NotificationChannelPrefs>> = {}
  const existing = await getSettingsProfile(userId)
  const existingPrefs = (existing as { notificationPreferences?: NotificationPreferences } | null)
    ?.notificationPreferences ?? {}
  const existingCategories = existingPrefs.categories ?? {}

  for (const key of Object.keys(merged) as (keyof UserAlertPreferences)[]) {
    const catId = CATEGORY_MAP[key]
    if (!catId) continue
    const prev = existingCategories[catId as keyof typeof existingCategories] as NotificationChannelPrefs | undefined
    categories[catId] = toChannelPref(merged[key], prev)
  }

  const mergedCategories = { ...existingCategories, ...categories }

  return updateUserProfile(userId, {
    notificationPreferences: {
      ...existingPrefs,
      categories: mergedCategories,
    },
  })
}
