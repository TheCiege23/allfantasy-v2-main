/**
 * Build Rolling Insights SOCCER URLs — always requires `league` + `RSC_token`. Never log tokens.
 */

import {
  normalizeSoccerLeague,
  type RollingInsightsSoccerLeagueCode,
} from '@/lib/providers/rollingInsightsSoccerLeague'

export type RollingInsightsSoccerUrlEndpoint =
  | 'team_info'
  | 'player_info'
  | 'schedule_season'
  | 'schedule_daily'
  | 'schedule_weekly'
  | 'live'
  | 'team_stats'

export type BuildRollingInsightsSoccerUrlInput = {
  /** Query param — required */
  token: string
  /** EPL | LALIGA | SERIEA or normalized label */
  league: string
  /** YYYY for season endpoints / team-stats; YYYY-MM-DD for schedule/live */
  seasonOrDate?: string
  teamId?: string
  playerId?: string
  gameId?: string
  relegated?: boolean | 'TRUE' | 'FALSE'
  /** Use `/api/v1/schedule/<DATE>/SOCCER` instead of documented `schedule-daily` */
  useScheduleAlias?: boolean
}

export type BuildRollingInsightsSoccerUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: 'league_required' | 'token_required' | 'season_or_date_required' | 'invalid_league' }

function qp(entries: Record<string, string | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(entries)) {
    if (v === undefined || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/**
 * Assemble documented paths; defaults daily schedule to **`schedule-daily`**.
 */
export function buildRollingInsightsSoccerUrl(
  endpoint: RollingInsightsSoccerUrlEndpoint,
  input: BuildRollingInsightsSoccerUrlInput,
): BuildRollingInsightsSoccerUrlResult {
  if (!input.token?.trim()) return { ok: false, error: 'token_required' }
  const lg = normalizeSoccerLeague(input.league)
  if (!input.league?.trim()) return { ok: false, error: 'league_required' }
  if (!lg) return { ok: false, error: 'invalid_league' }

  const leagueCode: RollingInsightsSoccerLeagueCode = lg
  const base = (path: string, extra: Record<string, string | undefined> = {}) =>
    ({
      ok: true as const,
      url: `${path}${qp({
        RSC_token: input.token,
        league: leagueCode,
        ...extra,
      })}`,
    }) as BuildRollingInsightsSoccerUrlResult

  const d = input.seasonOrDate?.trim()

  switch (endpoint) {
    case 'team_info':
      return base('/api/v1/team-info/SOCCER', {
        team_id: input.teamId,
        relegated:
          input.relegated === undefined
            ? undefined
            : input.relegated === true || input.relegated === 'TRUE'
              ? 'TRUE'
              : 'FALSE',
      })
    case 'player_info':
      return base('/api/v1/player-info/SOCCER', {
        team_id: input.teamId,
        player_id: input.playerId,
      })
    case 'schedule_season':
      if (!d) return { ok: false, error: 'season_or_date_required' }
      return base(`/api/v1/schedule-season/${d}/SOCCER`, { team_id: input.teamId })
    case 'schedule_daily': {
      if (!d) return { ok: false, error: 'season_or_date_required' }
      const path = input.useScheduleAlias
        ? `/api/v1/schedule/${d}/SOCCER`
        : `/api/v1/schedule-daily/${d}/SOCCER`
      return {
        ok: true,
        url: `${path}${qp({
          RSC_token: input.token,
          league: leagueCode,
          team_id: input.teamId,
          game_id: input.gameId,
        })}`,
      }
    }
    case 'schedule_weekly':
      if (!d) return { ok: false, error: 'season_or_date_required' }
      return base(`/api/v1/schedule-weekly/${d}/SOCCER`, { team_id: input.teamId })
    case 'live':
      if (!d) return { ok: false, error: 'season_or_date_required' }
      return base(`/api/v1/live/${d}/SOCCER`, {
        team_id: input.teamId,
        game_id: input.gameId,
      })
    case 'team_stats':
      if (!d) return { ok: false, error: 'season_or_date_required' }
      return base(`/api/v1/team-stats/${d}/SOCCER`, { team_id: input.teamId })
    default:
      return { ok: false, error: 'season_or_date_required' }
  }
}
