import type { ApiFetchParams, ApiProvider } from '@/lib/workers/api-config'
import { toApiChainSport } from '@/lib/workers/api-config'
import { getCfbdApiKey } from '@/lib/cfbd-env'

const CFBD_BASE_URL = 'https://api.collegefootballdata.com'

function currentSeason(): string {
  return String(new Date().getFullYear())
}

function apiKey(): string {
  return getCfbdApiKey()
}

async function cfbdFetch<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const key = apiKey()
  if (!key) return null

  const url = new URL(`${CFBD_BASE_URL}${path}`)
  Object.entries(params ?? {}).forEach(([param, value]) => {
    if (value) url.searchParams.set(param, value)
  })

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) return null
  return (await response.json()) as T
}

export const cfbdProvider: ApiProvider = {
  name: 'cfbd',
  supports: ({ sport, dataType }: ApiFetchParams) =>
    toApiChainSport(sport as string) === 'ncaaf' && ['teams', 'games', 'schedule'].includes(dataType),
  async fetch({ dataType, query = {} }: ApiFetchParams) {
    const season = typeof query.season === 'string' && query.season.trim()
      ? query.season.trim()
      : currentSeason()

    switch (dataType) {
      case 'teams': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/teams/fbs', { year: season })
        return (rows ?? []).map((team) => ({
          id: String(team.id ?? team.school ?? ''),
          name: String(team.school ?? ''),
          shortName: String(team.abbreviation ?? '').trim() || null,
          conference: String(team.conference ?? '').trim() || null,
          source: 'cfbd',
        })).filter((team) => team.id && team.name)
      }
      case 'games':
      case 'schedule': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/games', { year: season })
        return (rows ?? []).map((game) => ({
          id: String(game.id ?? `${game.home_team ?? ''}-${game.away_team ?? ''}-${game.start_date ?? ''}`),
          homeTeam: String(game.home_team ?? ''),
          awayTeam: String(game.away_team ?? ''),
          date: String(game.start_date ?? ''),
          status: String(game.completed ? 'final' : 'scheduled'),
          season,
          venue: String(game.venue ?? '').trim() || null,
          homeScore: typeof game.home_points === 'number' ? game.home_points : null,
          awayScore: typeof game.away_points === 'number' ? game.away_points : null,
          source: 'cfbd',
        })).filter((game) => game.id)
      }
      default:
        return null
    }
  },
}
