import { getLeagueInfo, type SleeperLeague } from '@/lib/sleeper-client'

interface SleeperHistoricalLeagueSeason {
  externalLeagueId: string
  season: number
  league: SleeperLeague
}

function parseSeasonNumber(value: unknown): number | null {
  const season =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN

  return Number.isFinite(season) ? season : null
}

export async function getSleeperHistoricalLeagueChain(
  startingLeagueId: string,
  maxPreviousSeasons: number
): Promise<SleeperHistoricalLeagueSeason[]> {
  const chain: SleeperHistoricalLeagueSeason[] = []
  const seenLeagueIds = new Set<string>()
  let currentLeagueId: string | null = startingLeagueId
  const maxHistoryDepth = Math.max(maxPreviousSeasons, 0) + 1

  while (currentLeagueId && chain.length < maxHistoryDepth) {
    if (seenLeagueIds.has(currentLeagueId)) {
      break
    }
    seenLeagueIds.add(currentLeagueId)

    const league = await getLeagueInfo(currentLeagueId)
    if (!league?.league_id) {
      break
    }

    const season = parseSeasonNumber(league.season)
    if (season != null) {
      chain.push({
        externalLeagueId: league.league_id,
        season,
        league,
      })
    }

    currentLeagueId = league.previous_league_id ?? null
  }

  return chain
}
