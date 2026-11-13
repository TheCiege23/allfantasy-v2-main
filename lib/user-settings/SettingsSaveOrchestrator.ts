import { updateUserProfile } from "./UserProfileService"
import { saveUserSettings } from "./UserSettingsService"
import {
  applyResolvedUniversalPreferences,
  type UniversalPreferenceResolution,
} from "./UniversalPreferenceResolver"
import type { SettingsSavePayload } from "./types"

interface SaveSettingsInput {
  userId: string
  payload: SettingsSavePayload
  existingPreferenceFallback?: {
    preferredLanguage?: string | null
    themePreference?: string | null
    timezone?: string | null
  }
}

interface SaveSettingsResult {
  ok: boolean
  error?: string
  resolvedPreferences?: UniversalPreferenceResolution
}

export async function saveSettingsOrchestrated(
  input: SaveSettingsInput
): Promise<SaveSettingsResult> {
  const profilePayload = input.payload.profile
    ? applyResolvedUniversalPreferences(
        input.payload.profile,
        input.existingPreferenceFallback
      )
    : undefined

  if (profilePayload) {
    const profileResult = await updateUserProfile(input.userId, profilePayload)
    if (!profileResult.ok) {
      return {
        ok: false,
        error: profileResult.error ?? "Failed to save profile settings",
      }
    }
  }

  if (input.payload.settings) {
    const settingsResult = await saveUserSettings(input.userId, input.payload.settings)
    if (!settingsResult.ok) {
      return {
        ok: false,
        error: settingsResult.error ?? "Failed to save user settings",
      }
    }
  }

  return {
    ok: true,
    resolvedPreferences: profilePayload
      ? {
          preferredLanguage: profilePayload.preferredLanguage ?? null,
          themePreference: profilePayload.themePreference ?? null,
          timezone: profilePayload.timezone ?? null,
        }
      : undefined,
  }
}
