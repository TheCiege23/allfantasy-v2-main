/**
 * URL builder for documented ClearSports NFL REST API (`api.clearsportsapi.com`).
 * Does not send requests — safe for tests and server callers.
 */

import {
  CLEARSPORTS_API_PUBLIC_BASE,
  CLEARSPORTS_NFL_ENDPOINTS,
} from '@/lib/providers/clearSportsFieldMaps'

export type ClearSportsNflEndpointKey =
  | 'player_stats'
  | 'team_stats'
  | 'injury_stats'
  | 'team_by_id'
  | 'games'

export type BuildClearSportsNflUrlOptions = {
  baseUrl?: string
  gameId?: string | number
  playerId?: string | number
  teamId?: string | number
  season?: string | number
  week?: string | number
  date?: string
}

function pathForKey(key: ClearSportsNflEndpointKey, teamId?: string | number): string {
  switch (key) {
    case 'player_stats':
      return CLEARSPORTS_NFL_ENDPOINTS.playerStats
    case 'team_stats':
      return CLEARSPORTS_NFL_ENDPOINTS.teamStats
    case 'injury_stats':
      return CLEARSPORTS_NFL_ENDPOINTS.injuryStats
    case 'team_by_id': {
      const id = teamId != null && String(teamId).trim() !== '' ? encodeURIComponent(String(teamId)) : ':teamId'
      return CLEARSPORTS_NFL_ENDPOINTS.teamById.replace(':teamId', id)
    }
    case 'games':
      return CLEARSPORTS_NFL_ENDPOINTS.games
    default:
      return CLEARSPORTS_NFL_ENDPOINTS.games
  }
}

function addParam(url: URL, name: string, v: unknown): void {
  if (v === undefined || v === null || v === '') return
  url.searchParams.set(name, String(v))
}

/** Build absolute ClearSports NFL URL; omits unset query params. Never logs secrets. */
export function buildClearSportsNflUrl(
  endpoint: ClearSportsNflEndpointKey,
  options: BuildClearSportsNflUrlOptions = {},
): string {
  const base = (options.baseUrl ?? CLEARSPORTS_API_PUBLIC_BASE).replace(/\/+$/, '')
  const path = pathForKey(endpoint, options.teamId)
  const url = new URL(`${base}${path}`)

  switch (endpoint) {
    case 'player_stats':
      addParam(url, 'game_id', options.gameId)
      addParam(url, 'player_id', options.playerId)
      addParam(url, 'team_id', options.teamId)
      addParam(url, 'season', options.season)
      addParam(url, 'week', options.week)
      break
    case 'team_stats':
      addParam(url, 'game_id', options.gameId)
      addParam(url, 'team_id', options.teamId)
      addParam(url, 'season', options.season)
      addParam(url, 'week', options.week)
      break
    case 'injury_stats':
      addParam(url, 'team_id', options.teamId)
      addParam(url, 'player_id', options.playerId)
      addParam(url, 'week', options.week)
      addParam(url, 'season', options.season)
      break
    case 'games':
      addParam(url, 'season', options.season)
      addParam(url, 'week', options.week)
      addParam(url, 'team_id', options.teamId)
      addParam(url, 'date', options.date)
      break
    case 'team_by_id':
      break
    default:
      break
  }

  return url.toString()
}
