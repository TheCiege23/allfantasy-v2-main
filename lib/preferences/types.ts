/**
 * Universal preference types for language, theme, and timezone.
 * Used across Sports App, Bracket Challenge, Legacy, settings, and auth.
 */

export type { LanguageCode } from "@/lib/i18n/constants"

export type ThemeMode = "light" | "dark" | "legacy"

export type TimezoneIana = string

export interface UniversalPreferences {
  preferredLanguage: LanguageCode | null
  themePreference: ThemeMode | null
  timezone: TimezoneIana | null
}
