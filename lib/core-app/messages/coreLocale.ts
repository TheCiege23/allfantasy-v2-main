import { defineMessages, messagesFor } from '@/lib/i18n/messages'

/**
 * Language codes and Intl locales for /core surfaces whose copy exists only in English and Spanish.
 *
 * These were inline Spanish-or-English ternaries, and they disagree on purpose: some format
 * dates as 'es-US' / 'en-US', some as a bare 'es' / 'en'. Each key keeps one existing pair exactly,
 * and any other language falls back to the English value — the same result the ternary gave.
 * (`getIntlLocale` is not a substitute: it answers 'es' for Spanish and 'zh-CN' etc. for the rest.)
 */
export const coreLocaleMessages = defineMessages({
  en: {
    /** The copy language for an EN/ES-only payload ({ en, es } records, `lang` params). Also a bare Intl locale. */
    code: 'en' as 'en' | 'es',
    /** Regional US locale. */
    usLocale: 'en-US',
    /** 'en-US' for English, bare 'es' for Spanish — the pair `getIntlLocale` gives for these two. */
    intlLocale: 'en-US',
    /** Empty means "the browser's own locale" (pass `|| undefined` to Intl). */
    browserLocale: '',
  },
  es: {
    code: 'es',
    usLocale: 'es-US',
    intlLocale: 'es',
    browserLocale: 'es',
  },
})

export const coreLocale = (language: string | null | undefined) => messagesFor(coreLocaleMessages, language)

/** The EN/ES copy language for a reader: Spanish for 'es', English for everything else. */
export const coreLang = (language: string | null | undefined): 'en' | 'es' => coreLocale(language).code

/** The Spanish flag those older EN/ES helpers take (weeklyShare, weeklyBlueprint, AfSavedShare …). */
export const spanishFlag = (language: string | null | undefined): boolean => coreLang(language) === 'es'

/** The copy language for the older EN/ES helpers that take a Spanish flag instead of a language code. */
export function langFromFlag(spanishCopy: boolean): 'en' | 'es' {
  if (spanishCopy) return 'es'
  return 'en'
}
