/**
 * Format model registry. PURE.
 *
 * ── 🛑 AN UNKNOWN FORMAT RETURNS NULL, NOT A DEFAULT MODEL ──────────────────────────────────
 * Fifteen of the sixteen formats this codebase implements have no model yet. A "generic" fallback
 * would apply somebody's guess about guillotine to a pirate league and produce a number nobody
 * chose — the exact failure the census measured, where all 16 formats priced identically at 6552
 * because `ScoringContext` had no field a format could travel through.
 *
 * Null means "no format opinion". The shared engine still prices the asset from `LeagueShape`,
 * scoring settings and the market, which is a real answer; what it does not do is invent a
 * format-specific adjustment for a format nobody has modelled.
 */

import type { FormatValueModel } from './types'
import { fourHorsemenModel } from './fourHorsemen'

/**
 * Formats with a real code presence in this repo, from the 2026-09-01 census (string-literal
 * occurrence counts across lib/ + app/ + types/). Listed so the gap is visible rather than implied.
 *
 * ⚠ `four_horsemen` IS NOT IN THIS LIST, AND THE DISTINCTION IS REAL. The census searched for
 * coded format types; Four Horsemen appears only as a league NAME in test fixtures. It is a
 * specific dynasty league with unusual settings, not a format the platform implements — which is
 * why it can be modelled while all sixteen coded formats remain unmodelled. `modelledFormatIds()`
 * returning 1 while `unmodelledFormatIds()` returns 16 is therefore correct, not an off-by-one.
 */
export const KNOWN_FORMAT_IDS = [
  'redraft', 'dynasty', 'devy', 'survivor', 'keeper', 'zombie', 'tournament',
  'guillotine', 'best_ball', 'big_brother', 'exile', 'salary_cap', 'idol',
  'king_of_the_hill', 'lottery', 'pirate',
] as const

const MODELS: readonly FormatValueModel[] = [fourHorsemenModel]

const BY_ID = new Map<string, FormatValueModel>(MODELS.map((m) => [m.formatId, m]))

/** Normalise a format id: case-insensitive, hyphens and spaces to underscores. */
function normalise(id: string | null | undefined): string {
  return String(id ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/**
 * The model for a format, or null when none exists.
 *
 * ⚠ Callers must handle null as "no adjustment", never as an error. Fifteen of sixteen formats
 * return null today and that is the honest state, not a bug to be papered over.
 */
export function formatModelFor(formatId: string | null | undefined): FormatValueModel | null {
  const id = normalise(formatId)
  if (!id) return null
  return BY_ID.get(id) ?? null
}

/** Which formats have a model. Useful for surfacing coverage rather than guessing at it. */
export function modelledFormatIds(): string[] {
  return [...BY_ID.keys()].sort()
}

/** Formats with real code in the repo but no value model yet. */
export function unmodelledFormatIds(): string[] {
  return KNOWN_FORMAT_IDS.filter((id) => !BY_ID.has(id)).slice().sort()
}
