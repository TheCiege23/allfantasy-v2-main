import { DEFAULT_LANG, resolveLanguage, type LanguageCode } from "@/lib/i18n/constants"

export function resolvePreferredLanguage(input: unknown): LanguageCode {
  if (typeof input === "string") return resolveLanguage(input)
  return DEFAULT_LANG
}
