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

/**
 * The rail's career line (`railCareerLine`): "23-11 · 2 titles", "1 title". The record is numbers and
 * stays; only the title count is a word.
 */
export function careerLineText(line: string, language: string): string {
  if (language !== 'es') return line
  return line.replace(/\b(\d+) (titles?)$/, (_m, n: string) => `${n} ${n === '1' ? 'título' : 'títulos'}`)
}

/** "Sleeper, ESPN, Fantrax, MFL or Fleaflicker" — `availableImportPlatformsPhrase` joins with " or ". */
export function platformsPhraseText(phrase: string, language: string): string {
  if (language !== 'es') return phrase
  const at = phrase.lastIndexOf(' or ')
  return at < 0 ? phrase : `${phrase.slice(0, at)} o ${phrase.slice(at + 4)}`
}

/**
 * A relative age in the reader's language. Covers both formatters /core uses: `describeAge`
 * ("45s ago", "4m ago", "3h ago", "2d ago", "never synced") and `relativeAge` in cardFreshness.ts
 * ("just now", "4 min ago", "3w ago", "2mo ago", "1y ago"). Anything it does not recognise passes
 * through.
 *
 * ⚠ `min` AND `mo` MUST BE TRIED BEFORE `m` — with `m` first, "2mo ago" matches `m` and then fails on
 * the "o", so the month and year ages (the long-stale leagues a stale stamp exists to flag) passed
 * through as English. Caught by the My Team session before this shipped. Month and year are written
 * out, so they take a plural; the abbreviated units do not.
 */
export function ageText(age: string, language: string): string {
  if (language !== 'es') return age
  const a = age.trim()
  if (/^just now$/i.test(a)) return 'justo ahora'
  if (/^never\b/i.test(a)) return 'nunca'
  const m = a.match(/^(\d+)\s*(min|mo|s|m|h|d|w|y)\s+ago$/i)
  if (!m) return age
  const n = Number(m[1])
  switch (m[2]!.toLowerCase()) {
    case 's':
      return `hace ${n} s`
    case 'm':
    case 'min':
      return `hace ${n} min`
    case 'h':
      return `hace ${n} h`
    case 'd':
      return `hace ${n} d`
    case 'w':
      return `hace ${n} sem`
    case 'mo':
      return `hace ${n} ${n === 1 ? 'mes' : 'meses'}`
    default:
      return `hace ${n} ${n === 1 ? 'año' : 'años'}`
  }
}
