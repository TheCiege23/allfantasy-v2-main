import { coreLang } from '@/lib/core-app/messages/coreLocale'

/**
 * `L(english, spanish)` for the reader's language (2026-10-05).
 *
 * The Commissioner Hub's server builders write their sentences in the reader's language at the source,
 * where the values a sentence is built from are in hand. Each takes the language, defaulting to
 * English, so every other caller reads exactly what it always did. PURE and client-safe.
 */
export function pickLanguage(language: string | null | undefined = 'en') {
  const lang = coreLang(language)
  return (english: string, spanish: string): string => ({ en: english, es: spanish })[lang]
}
