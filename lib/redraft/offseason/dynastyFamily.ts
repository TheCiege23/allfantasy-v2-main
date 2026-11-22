/**
 * Which leagues keep their rosters from season to season. Pure, so a client component can ask the
 * same question the offseason does; ./carryDynastyRosters.ts re-exports it for its existing importers.
 */

const DYNASTY_FAMILY_TYPES = new Set(['dynasty', 'devy', 'c2c'])

/** Dynasty, devy and C2C keep their rosters and hold a rookie draft; `isDynasty` covers legacy rows. */
export function isDynastyFamilyLeague(league: { leagueType?: string | null; isDynasty?: boolean | null }): boolean {
  if (league.isDynasty === true) return true
  return DYNASTY_FAMILY_TYPES.has(String(league.leagueType ?? '').toLowerCase())
}
