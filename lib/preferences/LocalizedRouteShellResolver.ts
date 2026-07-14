/**
 * Resolve locale/language for route shells and server components.
 * Client-side language lives in LanguageProviderClient; this provides constants and validation.
 */

import { SUPPORTED_LANGUAGES, resolveLanguage as resolveCanonicalLanguage, type LanguageCode } from "@/lib/i18n/constants"

export const SUPPORTED_LOCALES: LanguageCode[] = [...SUPPORTED_LANGUAGES]

export function isValidLanguage(value: string | null | undefined): value is LanguageCode {
  return SUPPORTED_LANGUAGES.includes(value as LanguageCode)
}

export function resolveLanguage(value: string | null | undefined): LanguageCode {
  return resolveCanonicalLanguage(value)
}
