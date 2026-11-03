import { getIntlLocale, resolveLanguage } from './constants'

/**
 * For the APIs and server payloads that only carry English and Spanish (`?lang=`, `{ en, es }` copy
 * written by a service): Spanish for Spanish, English for every other app language.
 *
 * UI strings do not belong here — put them in the message catalog (lib/i18n/translations.ts) and
 * read them with `t`. This is the one place a component's English/Spanish choice is made, so a
 * screen never needs its own `language === 'es'` (scripts/i18n-ternary-ratchet.mjs).
 */
export type EnEs = 'en' | 'es'

export function enEsLanguage(language: string | null | undefined): EnEs {
  return resolveLanguage(language) === 'es' ? 'es' : 'en'
}

/** The side of a server-written `{ en, es }` pair for this language (English for any other language). */
export function pickEnEs<T>(pair: { en: T; es: T }, language: string | null | undefined): T {
  return pair[enEsLanguage(language)]
}

/**
 * A locale for `toLocaleString` where English deliberately uses the browser's own locale (an en-GB
 * reader keeps en-GB dates) and every other language gets its Intl locale (lib/i18n/constants).
 */
export function intlLocaleOrBrowserDefault(language: string | null | undefined): string | undefined {
  const code = resolveLanguage(language)
  return code === 'en' ? undefined : getIntlLocale(code)
}
