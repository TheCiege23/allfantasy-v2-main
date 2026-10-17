/** Canonical creation stores the concept in leagueType; legacy leagues use leagueVariant.
 * Normalize only the client read model so the house navigation and standings agree.
 * An explicit variant stays authoritative, and no persisted league fields are changed.
 */
export function normalizeBigBrotherShellLeague<T extends { leagueType?: string | null; leagueVariant?: string | null }>(league: T): T {
  if (!league.leagueVariant && league.leagueType === 'big_brother') {
    return { ...league, leagueVariant: 'big_brother' }
  }
  return league
}
