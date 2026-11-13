import {
  resolveLanguagePreferenceSync,
  type LanguagePreferenceSyncResult,
} from "@/lib/preferences/LanguagePreferenceSyncService"
import {
  resolveThemePreferenceSync,
  type ThemePreferenceSyncResult,
} from "@/lib/preferences/ThemePreferenceSyncService"
import {
  detectBrowserTimezone,
  resolveTimezonePreferenceSync,
  type TimezonePreferenceSyncResult,
} from "@/lib/preferences/TimezonePreferenceSyncService"

interface SharedSessionBootstrapInput {
  profile: Record<string, unknown> | null
  storedLanguagePreference: string | null
  storedThemePreference: string | null
}

interface SharedSessionBootstrapResult {
  language: LanguagePreferenceSyncResult["language"]
  theme: ThemePreferenceSyncResult["theme"]
  timezone: TimezonePreferenceSyncResult["timezone"]
  patchPayload: {
    preferredLanguage?: string
    themePreference?: string
    timezone?: string
  }
}

export function resolveSharedSessionBootstrap(
  input: SharedSessionBootstrapInput
): SharedSessionBootstrapResult {
  const profilePreferredLanguage =
    typeof input.profile?.preferredLanguage === "string"
      ? input.profile.preferredLanguage
      : null
  const profileThemePreference =
    typeof input.profile?.themePreference === "string"
      ? input.profile.themePreference
      : null
  const profileTimezone =
    typeof input.profile?.timezone === "string" ? input.profile.timezone : null

  const languageSync = resolveLanguagePreferenceSync({
    profilePreferredLanguage,
    storedLanguagePreference: input.storedLanguagePreference,
  })
  const themeSync = resolveThemePreferenceSync({
    profileThemePreference,
    storedThemePreference: input.storedThemePreference,
  })
  const timezoneSync = resolveTimezonePreferenceSync({
    profileTimezone,
    browserTimezone: detectBrowserTimezone(),
  })

  const patchPayload: SharedSessionBootstrapResult["patchPayload"] = {}
  if (languageSync.shouldPersistToProfile) {
    patchPayload.preferredLanguage = languageSync.language
  }
  if (themeSync.shouldPersistToProfile) {
    patchPayload.themePreference = themeSync.theme
  }
  if (timezoneSync.shouldPersistToProfile) {
    patchPayload.timezone = timezoneSync.timezone
  }

  return {
    language: languageSync.language,
    theme: themeSync.theme,
    timezone: timezoneSync.timezone,
    patchPayload,
  }
}
