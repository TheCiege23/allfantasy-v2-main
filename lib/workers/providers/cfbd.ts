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
    toApiChainSport(sport as string) === 'ncaaf' &&
    [
      'teams',
      'games',
      'schedule',
      'scores',
      'players',
      'roster',
      'player_stats',
      'team_stats',
      'rankings',
      'standings',
    ].includes(dataType),
  async fetch({ dataType, query = {} }: ApiFetchParams) {
    const season = typeof query.season === 'string' && query.season.trim()
      ? query.season.trim()
      : currentSeason()
    const week = typeof query.week === 'string' && query.week.trim() ? query.week.trim() : ''
    const team = typeof query.team === 'string' && query.team.trim()
      ? query.team.trim()
      : typeof query.teamName === 'string' && query.teamName.trim()
        ? query.teamName.trim()
        : ''

    switch (dataType) {
      case 'teams': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/teams/fbs', { year: season })
        return (rows ?? []).map((team) => ({
          id: String(team.id ?? team.school ?? ''),
          name: String(team.school ?? ''),
          shortName: String(team.abbreviation ?? '').trim() || null,
          conference: String(team.conference ?? '').trim() || null,
          logos: Array.isArray(team.logos) ? team.logos : [],
          source: 'cfbd',
        })).filter((team) => team.id && team.name)
      }
      case 'games':
      case 'scores':
      case 'schedule': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/games', { year: season })
        return (rows ?? []).map((game) => ({
          id: String(game.id ?? `${game.home_team ?? ''}-${game.away_team ?? ''}-${game.start_date ?? ''}`),
          homeTeam: String(game.home_team ?? ''),
          awayTeam: String(game.away_team ?? ''),
          week: typeof game.week === 'number' ? game.week : Number(game.week ?? 0) || null,
          date: String(game.start_date ?? ''),
          status: String(game.completed ? 'final' : 'scheduled'),
          season,
          venue: String(game.venue ?? '').trim() || null,
          homeScore: typeof game.home_points === 'number' ? game.home_points : null,
          awayScore: typeof game.away_points === 'number' ? game.away_points : null,
          source: 'cfbd',
        })).filter((game) => game.id)
      }
      case 'players':
      case 'roster': {
        if (!team) return []
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/roster', { year: season, team })
        return (rows ?? []).map((player) => ({
          id: String(player.id ?? player.player_id ?? player.name ?? ''),
          name: String(player.name ?? ''),
          position: String(player.position ?? '').trim() || null,
          team,
          jersey: player.jersey ?? null,
          height: player.height ?? null,
          weight: player.weight ?? null,
          year: player.year ?? null,
          source: 'cfbd',
        })).filter((player) => player.id && player.name)
      }
      case 'player_stats': {
        const categories =
          typeof query.category === 'string' && query.category.trim()
            ? [query.category.trim()]
            : ['passing', 'rushing', 'receiving']
        const rows = (
          await Promise.all(
            categories.map((category) =>
              cfbdFetch<Array<Record<string, unknown>>>('/stats/player/season', {
                year: season,
                category,
                ...(team ? { team } : {}),
              }),
            ),
          )
        ).flatMap((result) => result ?? [])
        return rows.map((stat) => ({
          id: String(stat.playerId ?? stat.player ?? `${stat.team ?? ''}-${stat.player ?? ''}-${stat.category ?? ''}-${stat.statType ?? ''}`),
          playerId: String(stat.playerId ?? stat.player ?? ''),
          player: String(stat.player ?? ''),
          team: String(stat.team ?? '').trim() || null,
          conference: String(stat.conference ?? '').trim() || null,
          category: String(stat.category ?? '').trim() || null,
          statType: String(stat.statType ?? '').trim() || null,
          stat: stat.stat ?? null,
          source: 'cfbd',
        })).filter((stat) => stat.player)
      }
      case 'team_stats': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/stats/season', {
          year: season,
          ...(team ? { team } : {}),
        })
        return (rows ?? []).map((stat) => ({
          team: String(stat.team ?? '').trim(),
          conference: String(stat.conference ?? '').trim() || null,
          statName: String(stat.statName ?? stat.stat ?? '').trim() || null,
          statValue: stat.statValue ?? stat.value ?? null,
          source: 'cfbd',
        })).filter((stat) => stat.team)
      }
      case 'rankings': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/rankings', {
          year: season,
          ...(week ? { week } : {}),
          seasonType: 'regular',
        })
        return (rows ?? []).map((ranking) => ({
          season,
          week: ranking.week ?? (week || null),
          seasonType: ranking.seasonType ?? 'regular',
          polls: ranking.polls ?? [],
          source: 'cfbd',
        }))
      }
      case 'standings': {
        const rows = await cfbdFetch<Array<Record<string, unknown>>>('/records', { year: season })
        return (rows ?? []).map((record) => ({
          team: String(record.team ?? '').trim(),
          conference: String(record.conference ?? '').trim() || null,
          total: record.total ?? null,
          conferenceGames: record.conferenceGames ?? null,
          source: 'cfbd',
        })).filter((record) => record.team)
      }
      default:
        return null
    }
  },
}
