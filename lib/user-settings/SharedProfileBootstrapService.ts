import { SUPPORTED_SPORTS, LIVE_ONLY_SPORTS, isLiveSport } from "@/lib/sport-scope"
import { resolveSignupTimezone } from "@/lib/signup/TimezoneSelectorService"
import { resolveLanguage } from "@/lib/i18n/constants"
import { normalizeStoredTheme } from "@/lib/theme/constants"
import type { ProfileUpdatePayload, UserProfileForSettings } from "./types"

interface SharedProfileBootstrapInput {
  profile: Omit<UserProfileForSettings, "settings">
}

export interface SharedProfileBootstrapResult {
  profile: Omit<UserProfileForSettings, "settings">
  patchPayload: ProfileUpdatePayload
}

function normalizePreferredSports(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const normalized = value
    .map((entry) => String(entry).toUpperCase())
    .filter((entry): entry is string => isLiveSport(entry))
  if (normalized.length === 0) return null
  const deduped = Array.from(new Set(normalized))
  const ordered = [...SUPPORTED_SPORTS, ...LIVE_ONLY_SPORTS].filter((sport) => deduped.includes(sport))
  return ordered
}

export function resolveSharedProfileBootstrap(
  input: SharedProfileBootstrapInput
): SharedProfileBootstrapResult {
  const patchPayload: ProfileUpdatePayload = {}
  const profile = { ...input.profile }

  const resolvedLanguage = resolveLanguage(profile.preferredLanguage)
  if (profile.preferredLanguage !== resolvedLanguage) {
    profile.preferredLanguage = resolvedLanguage
    patchPayload.preferredLanguage = resolvedLanguage
  }

  const resolvedTheme = normalizeStoredTheme(profile.themePreference)
  if (profile.themePreference !== resolvedTheme) {
    profile.themePreference = resolvedTheme
    patchPayload.themePreference = resolvedTheme
  }

  const resolvedTimezone = resolveSignupTimezone(profile.timezone)
  if (profile.timezone !== resolvedTimezone) {
    profile.timezone = resolvedTimezone
    patchPayload.timezone = resolvedTimezone
  }

  const normalizedSports = normalizePreferredSports(profile.preferredSports)
  const existingSports = Array.isArray(profile.preferredSports)
    ? profile.preferredSports
    : null
  const sportsChanged =
    JSON.stringify(existingSports ?? null) !== JSON.stringify(normalizedSports)
  if (sportsChanged) {
    profile.preferredSports = normalizedSports
    patchPayload.preferredSports = normalizedSports
  }

  return { profile, patchPayload }
}
