import type { LanguageCode } from './constants'

/**
 * Per-feature message catalogs — the replacement for inline `language === 'es' ? … : …`.
 *
 * ⚠ /core CARRIES ~1,600 INLINE ENGLISH/SPANISH TERNARIES. Each one hard-codes exactly two languages,
 * so enabling a third (zh, fil and vi already have partial dictionaries, but /core cannot read them)
 * means editing every ternary in every file. A catalog keeps a feature's strings in one object per
 * language, beside the feature:
 *
 *   const gamePlan = defineMessages({
 *     en: { title: 'Game plan', leagues: (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}` },
 *     es: { title: 'Plan de juego', leagues: (n) => `${n} ${n === 1 ? 'liga' : 'ligas'}` },
 *   })
 *   const m = useMessages(gamePlan)   // client — components/i18n/useMessages.ts
 *   const m = messagesFor(gamePlan, language)  // anywhere else
 *
 * - Values are strings or functions, so plurals and interpolation stay ordinary, typed TypeScript —
 *   a Spanish function must take the same arguments as the English one, or it does not compile.
 *   ⚠ An English function returning only literals infers a literal union (`'league' | 'leagues'`),
 *   which no translation can satisfy; annotate it `: string`.
 * - `en` is complete by type; every other language is a partial overlay. A missing key falls back to
 *   English per key, never to a blank or a key name. Adding a language is adding one block.
 * - Why not the shared `t('key')` dictionary in lib/i18n/translations.ts: it is one 8,000-line file
 *   every session edits, its values are flat `{{var}}` templates with no plural logic, and its keys
 *   live far from the component that renders them. Catalogs keep the strings next to their screen.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Message = string | ((...args: any[]) => string)
export type Messages = Record<string, Message>

export type Catalog<M extends Messages> = { en: M } & { [L in Exclude<LanguageCode, 'en'>]?: Partial<M> }

/** Identity at runtime; exists so the catalog's shape is checked where it is written. */
export function defineMessages<M extends Messages>(catalog: Catalog<M>): Catalog<M> {
  return catalog
}

const merged = new WeakMap<object, Map<string, unknown>>()

/** The catalog for a language: that language's messages over English, per key. */
export function messagesFor<M extends Messages>(catalog: Catalog<M>, language: string | null | undefined): M {
  if (!language || language === 'en') return catalog.en
  const overlay = (catalog as Record<string, Partial<M> | undefined>)[language]
  if (!overlay) return catalog.en
  let byLang = merged.get(catalog)
  if (!byLang) merged.set(catalog, (byLang = new Map()))
  let out = byLang.get(language) as M | undefined
  if (!out) byLang.set(language, (out = { ...catalog.en, ...overlay } as M))
  return out
}

/** Keys of `en` that a language does not define (falls back to English). For completeness tests. */
export function missingMessages<M extends Messages>(catalog: Catalog<M>, language: LanguageCode): string[] {
  const overlay = (catalog as Record<string, Partial<M> | undefined>)[language] ?? {}
  return Object.keys(catalog.en).filter((k) => !(k in overlay))
}
