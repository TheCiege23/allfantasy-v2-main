/**
 * Bridges between a language code and the Spanish FLAG some /core helpers and props still take
 * (`TriageFreeAgentCta`'s `es`, `coverText(l, es)`). Prefer passing the language code; these let a
 * caller stop deriving the flag inline without widening a signature in a file it does not own.
 * Behaviour is exactly the inline forms they replace: only 'es' is Spanish, everything else English.
 */
export function isSpanishLanguage(language: string | null | undefined): boolean {
  return language === 'es'
}

export function languageOfSpanishFlag(spanishFlag: boolean): 'es' | 'en' {
  return spanishFlag ? 'es' : 'en'
}
