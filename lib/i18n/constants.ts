/**
 * Multi-language system for AllFantasy.
 * Used by: LanguageProviderClient, LanguageToggle, Settings, SyncProfilePreferences.
 * Storage: localStorage af_lang; API: UserProfile.preferredLanguage.
 */

export type LanguageCode = 'en' | 'es' | 'zh' | 'fil' | 'vi' | 'fr' | 'ar'
export type LanguageSupportStatus = 'production-ready' | 'partial' | 'beta' | 'future-only'
export type TextDirection = 'ltr' | 'rtl'

export const LANG_STORAGE_KEY = 'af_lang'
export const LANG_COOKIE_KEY = 'af_lang'

export const DEFAULT_LANG: LanguageCode = 'en'

export const SUPPORTED_LANGUAGES: LanguageCode[] = ['en', 'es', 'zh', 'fil', 'vi', 'fr', 'ar']
export const PRODUCTION_LANGUAGE_CODES: LanguageCode[] = ['en']
export const BETA_LANGUAGE_CODES: LanguageCode[] = ['zh', 'fil', 'vi']
export const FUTURE_LANGUAGE_CODES: LanguageCode[] = ['fr', 'ar']

export const LANGUAGE_DISPLAY_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  es: 'Espa\u00f1ol',
  zh: '\u4e2d\u6587',
  fil: 'Filipino',
  vi: 'Ti\u1ebfng Vi\u1ec7t',
  fr: 'Fran\u00e7ais',
  ar: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629',
}

export const LANGUAGE_SUPPORT_STATUS: Record<LanguageCode, LanguageSupportStatus> = {
  en: 'production-ready',
  es: 'partial',
  zh: 'beta',
  fil: 'beta',
  vi: 'beta',
  fr: 'future-only',
  ar: 'future-only',
}

export const LANGUAGE_TEXT_DIRECTION: Record<LanguageCode, TextDirection> = {
  en: 'ltr',
  es: 'ltr',
  zh: 'ltr',
  fil: 'ltr',
  vi: 'ltr',
  fr: 'ltr',
  ar: 'rtl',
}

export const LANGUAGE_INTL_LOCALE: Record<LanguageCode, string> = {
  en: 'en-US',
  es: 'es',
  zh: 'zh-CN',
  fil: 'fil-PH',
  vi: 'vi-VN',
  fr: 'fr-FR',
  ar: 'ar',
}

export function getLanguageDisplayName(code: LanguageCode): string {
  return LANGUAGE_DISPLAY_NAMES[code] ?? code
}

export function getLanguageSupportStatus(code: LanguageCode): LanguageSupportStatus {
  return LANGUAGE_SUPPORT_STATUS[code] ?? 'future-only'
}

export function getLanguageTextDirection(code: LanguageCode): TextDirection {
  return LANGUAGE_TEXT_DIRECTION[code] ?? 'ltr'
}

export function getIntlLocale(code: string | null | undefined): string {
  return LANGUAGE_INTL_LOCALE[resolveLanguage(code)]
}

export function getLanguageOptionLabel(code: LanguageCode): string {
  const name = getLanguageDisplayName(code)
  const status = getLanguageSupportStatus(code)
  if (status === 'beta') return `${name} (Beta)`
  if (status === 'future-only') return `${name} (Coming Soon)`
  if (status === 'partial') return `${name} (Partial)`
  return name
}

export function resolveLanguage(value: string | null | undefined): LanguageCode {
  if (
    value === 'en' ||
    value === 'es' ||
    value === 'zh' ||
    value === 'fil' ||
    value === 'vi' ||
    value === 'fr' ||
    value === 'ar'
  ) return value
  return DEFAULT_LANG
}
