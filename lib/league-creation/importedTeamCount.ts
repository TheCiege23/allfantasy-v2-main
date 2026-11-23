/**
 * Team counts for carrying an imported league over into a native league.
 *
 * Native creation offers each league type a fixed list of team counts (the options catalog).
 * A carryover must keep every imported team, so a 9- or 32-team dynasty import used to be
 * refused as dynasty even though nothing in the engines needs the count to be on that list.
 *
 * So, for a carryover ONLY, the imported league's own team count is accepted for the types
 * below as long as it sits between the type's smallest catalog size and 32 (the redraft
 * maximum). The carryover path separately requires the requested count to equal the imported
 * league's real count, so this never lets a native create pick an arbitrary size.
 *
 * Types left out are special modes whose rules are sized to their catalog lists (Zombie,
 * Guillotine, Survivor, Salary Cap, Devy, C2C, IDP, Tournament, Big Brother); they keep
 * today's lists until each is confirmed to handle other sizes.
 */

import { MAX_NATIVE_TEAMS } from '@/lib/league/teamCountLimits'

/**
 * C2C joined 2026-11-22, when a college C2C league's size was capped at what its pro side can fill:
 * the owner's Road To Glory college C2C leagues run 140 and 180 teams on Fantrax and keep that size.
 */
const IMPORT_FLEXIBLE_TEAM_COUNT_TYPES: readonly string[] = ['redraft', 'dynasty', 'keeper', 'best_ball', 'c2c']

/** Same ceiling as a native redraft league. */
const IMPORTED_TEAM_COUNT_MAX = MAX_NATIVE_TEAMS

/** True when `teamCount` may be used for `leagueType` in an import carryover. */
export function isImportedTeamCountAllowed(
  leagueType: string | null | undefined,
  teamCount: number,
  catalogCounts: readonly number[],
): boolean {
  if (catalogCounts.includes(teamCount)) return true
  if (!leagueType || !IMPORT_FLEXIBLE_TEAM_COUNT_TYPES.includes(leagueType)) return false
  if (!Number.isInteger(teamCount)) return false
  const min = catalogCounts.length > 0 ? Math.min(...catalogCounts) : 2
  return teamCount >= min && teamCount <= IMPORTED_TEAM_COUNT_MAX
}

/** The catalog list, plus the imported count when a carryover may use it for this type. */
export function teamCountOptionsWithImported(
  catalogCounts: readonly number[],
  leagueType: string | null | undefined,
  importedTeamCount: number | null | undefined,
): number[] {
  if (importedTeamCount == null || catalogCounts.includes(importedTeamCount)) return [...catalogCounts]
  if (!isImportedTeamCountAllowed(leagueType, importedTeamCount, catalogCounts)) return [...catalogCounts]
  return [...catalogCounts, importedTeamCount].sort((a, b) => a - b)
}
