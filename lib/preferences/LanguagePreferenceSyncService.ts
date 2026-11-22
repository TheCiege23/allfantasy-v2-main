import {
  DEFAULT_LANG,
  resolveLanguage,
  type LanguageCode,
} from "@/lib/i18n/constants"

interface LanguagePreferenceSyncInput {
  profilePreferredLanguage: string | null
  storedLanguagePreference: string | null
}

export interface LanguagePreferenceSyncResult {
  language: LanguageCode
  shouldPersistToProfile: boolean
}

export function resolveLanguagePreferenceSync(
  input: LanguagePreferenceSyncInput
): LanguagePreferenceSyncResult {
  const profileLanguage = resolveLanguage(input.profilePreferredLanguage)
  if (input.profilePreferredLanguage === profileLanguage) {
    return {
      language: profileLanguage,
      shouldPersistToProfile: false,
    }
  }

  const storedLanguage = resolveLanguage(input.storedLanguagePreference)
  if (input.storedLanguagePreference === storedLanguage) {
    return {
      language: storedLanguage,
      shouldPersistToProfile: true,
    }
  }

  return {
    language: resolveLanguage(DEFAULT_LANG),
    shouldPersistToProfile: false,
  }
}
