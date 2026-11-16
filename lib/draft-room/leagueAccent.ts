/**
 * Room v2 league-type accents (2026-11). One draft room for every league type, plus an accent of
 * its own: a chip naming the type in the header, a thin stripe under the header, and the
 * on-the-clock tile's color. Redraft keeps the room's cyan.
 *
 * Signature elements (tribe colors, an HOH crown, tournament groups, salary on the tile) come
 * later, once the room has that data; this file only decides the type and its color.
 *
 * The colors are not the position palette's (`positionTint.ts`): an accent marks the ROOM, and a
 * chip's text always names the type, so no meaning rides on the color alone.
 */
import { isLeagueConceptType, leagueConceptLabel, type LeagueConceptType } from '@/lib/league/leagueConceptOptions'

export type LeagueAccent = {
  concept: LeagueConceptType
  label: string
  /** Hex. Read through the shell's `--af-league-accent` CSS variable. */
  color: string
}

const ACCENT: Record<LeagueConceptType, string> = {
  redraft: '#22d3ee',
  dynasty: '#f5c451',
  keeper: '#f59e0b',
  best_ball: '#34d399',
  guillotine: '#f87171',
  survivor: '#fb923c',
  survivor_guillotine: '#f43f5e',
  tournament: '#818cf8',
  devy: '#c084fc',
  c2c: '#60a5fa',
  efl: '#f472b6',
  zombie: '#a3e635',
  pirate: '#5eead4',
  salary_cap: '#4ade80',
  big_brother: '#e879f9',
}

/** Spellings the database and imports have used for the same concept. */
const ALIASES: Record<string, LeagueConceptType> = {
  bestball: 'best_ball',
  guilly: 'guillotine',
  survivor_guilly: 'survivor_guillotine',
  salarycap: 'salary_cap',
  bigbrother: 'big_brother',
  campus_to_canton: 'c2c',
}

/**
 * The league's concept from `League.leagueType` (any casing, `-`/space/`_`). An unknown or empty
 * value is `dynasty` when the league is a dynasty league and `redraft` otherwise — the same
 * fallback the rest of the room uses for `isDynasty`.
 */
export function normalizeLeagueConcept(raw: string | null | undefined, opts: { isDynasty?: boolean } = {}): LeagueConceptType {
  const key = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const concept = ALIASES[key] ?? key
  if (isLeagueConceptType(concept)) return concept
  return opts.isDynasty ? 'dynasty' : 'redraft'
}

export function leagueAccentFor(raw: string | null | undefined, opts: { isDynasty?: boolean } = {}): LeagueAccent {
  const concept = normalizeLeagueConcept(raw, opts)
  return { concept, label: leagueConceptLabel(concept), color: ACCENT[concept] }
}

export function leagueAccentColor(concept: LeagueConceptType): string {
  return ACCENT[concept]
}
