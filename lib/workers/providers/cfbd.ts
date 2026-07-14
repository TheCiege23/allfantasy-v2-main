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

/**
 * CFBD roster positions that map to fantasy-relevant slots. CFBD rosters
 * include the full two-deep (OL/DL/etc.); we only seed offensive skill + K so
 * the NCAAF player pool mirrors the fantasy roster in `configs/ncaaf.ts`.
 */
const CFBD_FANTASY_POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'TE', 'K', 'PK', 'ATH'])

export type CfbdPlayerSeed = {
  id: string
  name: string
  team: string
  position: string
  jersey: number | null
  classYear: number | null
  height: number | null
  weight: number | null
  source: 'cfbd'
}

/**
 * Pure: map raw CFBD `/roster` rows into fantasy-relevant player seeds. Accepts
 * both the current camelCase and legacy snake_case field shapes, and filters to
 * offensive skill positions + K so the NCAAF pool matches the fantasy roster.
 */
export function mapCfbdRosterToPlayerSeeds(rows: Array<Record<string, unknown>> | null | undefined): CfbdPlayerSeed[] {
  return (rows ?? [])
    .map((p): CfbdPlayerSeed => {
      const first = String(p.firstName ?? p.first_name ?? '').trim()
      const last = String(p.lastName ?? p.last_name ?? '').trim()
      const name = `${first} ${last}`.trim()
      const position = String(p.position ?? '').trim().toUpperCase()
      const externalId = String(p.id ?? '').trim()
      const team = String(p.team ?? '').trim()
      return {
        id: externalId || `${name}-${team}`,
        name,
        team,
        position,
        jersey: typeof p.jersey === 'number' ? p.jersey : null,
        classYear: typeof p.year === 'number' ? p.year : null,
        height: typeof p.height === 'number' ? p.height : null,
        weight: typeof p.weight === 'number' ? p.weight : null,
        source: 'cfbd',
      }
    })
    .filter((p) => p.name && p.team && CFBD_FANTASY_POSITIONS.has(p.position))
}

export const cfbdProvider: ApiProvider = {
  name: 'cfbd',
  supports: ({ sport, dataType }: ApiFetchParams) =>
    toApiChainSport(sport as string) === 'ncaaf' && ['teams', 'games', 'schedule', 'players'].includes(dataType),
  async fetch({ dataType, query = {} }: ApiFetchParams) {
    const season = typeof query.season === 'string' && query.season.trim()
      ? query.season.trim()
      : currentSeason()

    switch (dataType) {
      case 'players': {
        // GET /roster?year=&classification=fbs — all FBS players for the season.
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/roster', {
          year: season,
          classification: 'fbs',
        })
        return mapCfbdRosterToPlayerSeeds(rows)
      }
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
