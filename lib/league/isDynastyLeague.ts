/**
 * The one answer to "is this a dynasty league?": rosters carry over, rookie picks are traded, and the
 * Dynasty / Taxi / Picks surfaces apply.
 *
 * Before this, four call sites each read a different subset of the league's fields: the dynasty
 * background read all of them, the league tab bar read only `leagueType` (exact case), the War Room
 * read only `isDynasty`, and the draft context read only `isDynasty`. A league stored as
 * `isDynasty: true, leagueType: 'redraft'` was dynasty to two of them and not to the other two.
 *
 * Strings are compared lowercased: production stores `DYNASTY_IDP`, and an exact-match comparison
 * against `'dynasty_idp'` silently never fires (see LeagueShell's IDP note).
 *
 * This does NOT exclude specialty formats. A guillotine or survivor league that keeps its rosters is
 * still dynasty here. Whether it gets the dynasty artwork is a presentation call, made by
 * `usesDynastyBackground` in lib/league-media/dynastyBackground.ts on top of this predicate.
 */
export type DynastyLeagueFields = {
  isDynasty?: boolean | null
  leagueType?: string | null
  leagueVariant?: string | null
  /** UserLeague.format: `leagueVariant ?? (isDynasty ? 'dynasty' : 'redraft')`. */
  format?: string | null
}

export const DYNASTY_LEAGUE_TYPES: readonly string[] = ['dynasty', 'devy', 'c2c']
export const DYNASTY_LEAGUE_VARIANTS: readonly string[] = ['dynasty', 'devy', 'c2c', 'devy_dynasty', 'merged_devy_c2c', 'dynasty_idp']

const lower = (value: string | null | undefined) => String(value ?? '').trim().toLowerCase()

export function isDynastyLeague(league: DynastyLeagueFields | null | undefined): boolean {
  if (!league) return false
  if (league.isDynasty) return true
  if (DYNASTY_LEAGUE_TYPES.includes(lower(league.leagueType))) return true
  if (DYNASTY_LEAGUE_VARIANTS.includes(lower(league.leagueVariant))) return true
  return lower(league.format) === 'dynasty'
}
