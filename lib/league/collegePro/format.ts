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

/**
 * Our sport code for a college half. Fantrax snapshots say `CFB` / `CBB`. Measured on Cream Bowl
 * 2026-11-21: `CFB`, which matched none of the 274 NCAAF games on file that day, so the page could
 * not tell a college game day from any other Saturday.
 */
export function normalizeCollegeSport(sport: string | null | undefined): string | null {
  const s = String(sport ?? '').trim().toUpperCase()
  if (!s) return null
  if (s === 'CFB' || s === 'NCAAFB' || s === 'NCAA_FB') return 'NCAAF'
  if (s === 'CBB' || s === 'NCAABB' || s === 'NCAA_BB') return 'NCAAB'
  return s
}

/** The college sport that pairs with a pro sport. */
export function collegeSportFor(proSport: string): string {
  return String(proSport).trim().toUpperCase() === 'NBA' ? 'NCAAB' : 'NCAAF'
}

/**
 * Whether the college half's points count toward the week, the commissioner's call.
 *
 * `separate`: college and pro are two matchups, each with its own score. That is how every
 * published C2C league runs, and the owner's default (2026-11-21).
 * `combined`: one weekly total, pro plus college, the way many C2C leagues let college players count.
 *
 * Stored on `League.settings.collegeProScoring`, registered in AF_OWNED_LEAGUE_SETTINGS_KEYS so a
 * re-import from Sleeper never deletes it. NOT on `C2CLeague.scoringMode`: that table drives the
 * native C2C engine, has no row for any imported league, and defaults to combined.
 */
export type CollegeProScoring = 'separate' | 'combined'
export const COLLEGE_PRO_SCORING_KEY = 'collegeProScoring'

export function readCollegeProScoring(settings: unknown): CollegeProScoring {
  const value = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[COLLEGE_PRO_SCORING_KEY] : null
  return value === 'combined' ? 'combined' : 'separate'
}

/** Pro plus college for the week, or null when neither half has a number yet. */
export function combinedTotal(pro: number | null, college: number | null): number | null {
  if (pro == null && college == null) return null
  return Math.round(((pro ?? 0) + (college ?? 0)) * 100) / 100
}
