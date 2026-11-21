/**
 * Is this a college + pro league, and which kind. Shared by the server loader and the league page,
 * which uses it to decide whether to ask for the two-lineup roster at all, so other leagues pay
 * nothing for it.
 *
 * C2C and Devy are different formats and are labelled apart (owner, 2026-11-21): Peach Bowl is
 * `leagueType: 'c2c'` with no variant.
 */

export type CollegeProFormat = 'c2c' | 'devy'

const C2C_TYPES = new Set(['c2c', 'merged_devy_c2c'])
const DEVY_TYPES = new Set(['devy', 'devy_dynasty'])

export function collegeProFormatOf(league: { leagueType?: string | null; leagueVariant?: string | null }): CollegeProFormat | null {
  const ids = [league.leagueType, league.leagueVariant].map((v) => String(v ?? '').trim().toLowerCase())
  if (ids.some((v) => C2C_TYPES.has(v))) return 'c2c'
  if (ids.some((v) => DEVY_TYPES.has(v))) return 'devy'
  return null
}

/** The college sport that pairs with a pro sport. */
export function collegeSportFor(proSport: string): string {
  return String(proSport).trim().toUpperCase() === 'NBA' ? 'NCAAB' : 'NCAAF'
}
