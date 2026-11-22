import { DEFAULT_LANG, getIntlLocale } from './constants'

/**
 * The Intl locale for numbers and dates in the reader's chosen language.
 *
 * ⚠ /core FORMATTED WITH A HARD-CODED 'en-US' IN ~60 PLACES AND WITH NO LOCALE AT ALL IN ~110 MORE.
 * The first ignored the language switch; the second used whatever locale the RUNTIME had — the
 * server's on the server, the browser's in the browser — so a reader in, say, Germany could get a
 * server-rendered "1,234" hydrate into "1.234": a hydration mismatch and a number that changed under
 * them, in a language they never picked.
 *
 * WHY A MODULE VALUE AND NOT A PARAMETER. Many of those calls sit in small module-level helpers and
 * `.ts` view-model files with no React context in reach; threading a language argument through each
 * would touch every caller for a formatting concern. Instead `applyLanguageToDocument` — the one
 * place the client language is committed, always from an effect or an event handler — records it
 * here, and formatting reads it.
 *
 * Why that is hydration-safe: it never changes on the server, so server HTML always formats as
 * 'en-US'; and in the browser it is only updated in an effect, which runs AFTER hydration, so the
 * hydrating render formats as 'en-US' too. Components that render after that (navigation, the
 * refresh the provider triggers on a switch) format in the chosen language.
 */
let current: string = getIntlLocale(DEFAULT_LANG)

export function getAppIntlLocale(): string {
  return current
}

/** Called only from `applyLanguageToDocument` (client, post-hydration). */
export function setAppIntlLanguage(language: string | null | undefined): void {
  if (typeof window === 'undefined') return
  current = getIntlLocale(language)
}
