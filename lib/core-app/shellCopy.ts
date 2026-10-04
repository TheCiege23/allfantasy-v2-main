/**
 * Spanish for the words the /core shell receives from the server (2026-10-03).
 *
 * The scope labels (`homeScope.ts`) and the sync age are built on the server in English and rendered
 * by client components, which know the reader's language. A live Spanish check of production found
 * them English on every /core screen. These translate at render, so a language switch takes effect at
 * once. Unknown text passes through unchanged — a league's own name is never touched here; callers
 * pass only scope labels.
 *
 * PURE and client-safe: no imports.
 */

/** "All leagues", "Favorite leagues", "NFL leagues", "Sleeper leagues" — the switcher's scope words. */
export function scopeLabelText(label: string, language: string): string {
  if (language !== 'es') return label
  if (label === 'All leagues') return 'Todas las ligas'
  if (label === 'Favorite leagues') return 'Ligas favoritas'
  if (label === 'Favorites') return 'Favoritas'
  const m = label.match(/^(.+) leagues$/)
  if (m) return `Ligas de ${m[1]}`
  return label
}

/**
 * League-type names (`LEAGUE_CONCEPT_OPTIONS`). Format names that Spanish-language fantasy products
 * keep as they are (Dynasty, Redraft, Keeper, Best Ball, Devy, EFL, Zombie, Big Brother, Campus to
 * Canton, Survivor) stay; the rest follow `coreUiCopy`'s own choice ("Guillotine" → "Guillotina").
 */
const LEAGUE_CONCEPT_ES: Record<string, string> = {
  Guillotine: 'Guillotina',
  'Survivor Guillotine': 'Guillotina Survivor',
  Tournament: 'Torneo',
  Pirate: 'Pirata',
  'Salary Cap': 'Tope salarial',
  'Choose league type': 'Elige el tipo de liga',
}

export function leagueConceptText(label: string, language: string): string {
  if (language !== 'es') return label
  return LEAGUE_CONCEPT_ES[label] ?? label
}

/** The two `CORE_SURFACE_LABELS` that `coreUiCopy` has no entry for; the rest go through it. */
export const SURFACE_LABEL_ES: Record<string, string> = {
  'League overview': 'Resumen de la liga',
  'Sync status': 'Estado de sincronización',
}

/** "Sleeper, ESPN, Fantrax, MFL or Fleaflicker" — `availableImportPlatformsPhrase` joins with " or ". */
export function platformsPhraseText(phrase: string, language: string): string {
  if (language !== 'es') return phrase
  const at = phrase.lastIndexOf(' or ')
  return at < 0 ? phrase : `${phrase.slice(0, at)} o ${phrase.slice(at + 4)}`
}

/**
 * A relative age the shell prints ("4m ago", "3h ago", "2d ago", "just now", "never") in the reader's
 * language. Anything it does not recognise passes through.
 */
export function ageText(age: string, language: string): string {
  if (language !== 'es') return age
  const a = age.trim()
  if (/^just now$/i.test(a)) return 'justo ahora'
  if (/^never\b/i.test(a)) return 'nunca'
  const m = a.match(/^(\d+)\s*(s|m|min|h|d|w)\s+ago$/i)
  if (!m) return age
  const unit = m[2]!.toLowerCase()
  const es = unit === 's' ? 's' : unit === 'm' || unit === 'min' ? 'min' : unit === 'h' ? 'h' : unit === 'd' ? 'd' : 'sem'
  return `hace ${m[1]} ${es}`
}
