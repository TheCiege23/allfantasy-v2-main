export type SearchableLeague = {
  id: string
  name: string
  platform: string
  mark: string
  imageUrl?: string | null
}

export type LeagueSearchHit = SearchableLeague & { kind: 'league' }

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

/**
 * Search only the leagues already loaded into the signed-in shell. Besides
 * avoiding another request, this guarantees that autocomplete never suggests
 * a league the viewer cannot open. Re-imported copies are collapsed by
 * platform + name, which is the strongest stable identity the rail carries.
 */
export function matchLeagueSearchHits(
  leagues: readonly SearchableLeague[],
  query: string,
  limit = 4,
): LeagueSearchHit[] {
  const term = normalized(query)
  if (term.length < 2 || limit <= 0) return []

  const seen = new Set<string>()
  return leagues
    .map((league, index) => {
      const name = normalized(league.name)
      const platform = normalized(league.platform)
      const at = name.indexOf(term)
      const platformAt = platform.indexOf(term)
      return {
        league,
        index,
        rank: at === 0 ? 0 : at > 0 ? 1 : platformAt === 0 ? 2 : platformAt > 0 ? 3 : 99,
      }
    })
    .filter((entry) => entry.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.league.name.localeCompare(b.league.name) || a.index - b.index)
    .filter(({ league }) => {
      const key = `${normalized(league.platform)}|${normalized(league.name)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map(({ league }) => ({ ...league, kind: 'league' as const }))
}
