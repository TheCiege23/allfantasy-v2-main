import 'server-only'

import type { LeagueSport } from '@prisma/client'
import {
  fetchNFLRoster,
  fetchNFLSchedule,
  fetchNFLTeams,
  type RIScheduleGame,
  type RITeam as RINflTeam,
  rollingInsightsGraphqlQuery,
} from '@/lib/rolling-insights'
import { fetchRITeams } from '@/lib/players/ri-players-server'
import type { RITeam as RIUnifiedTeam } from '@/lib/players/ri-players-server'
import { isSupportedSport, SUPPORTED_SPORTS } from '@/lib/sport-scope'

function parseLeagueSport(raw: string): LeagueSport | null {
  const u = raw.trim().toUpperCase()
  return isSupportedSport(u) ? (u as LeagueSport) : null
}

/** Normalized team for the internal GraphQL gateway */
type SportsDataTeam = {
  id: string
  name: string
  abbr: string
  sport: LeagueSport
  mascot: string | null
  logoUrl: string | null
}

/** Rolling Insights GraphQL field prefix (e.g. `nfl` → `nflTeams`, `nflSchedules`) */
const RI_PREFIX: Record<LeagueSport, string> = {
  NFL: 'nfl',
  MLB: 'mlb',
  NBA: 'nba',
  NHL: 'nhl',
  NCAAF: 'ncaaf',
  NCAAB: 'ncaab',
  SOCCER: 'soccer',
}

const SCHEDULE_SUBFIELDS = `gameId awayTeam homeTeam date status season venue { arena city state dome }`

function toSportsDataTeam(ri: RIUnifiedTeam, sport: LeagueSport): SportsDataTeam {
  return {
    id: ri.ri_id,
    name: ri.name,
    abbr: ri.abbr,
    sport,
    mascot: ri.mascot || null,
    logoUrl: ri.logo_url || null,
  }
}

function nflRiTeamToSportsDataTeam(t: RINflTeam): SportsDataTeam {
  return {
    id: t.id,
    name: t.team,
    abbr: t.abbrv,
    sport: 'NFL',
    mascot: t.mascot ?? null,
    logoUrl: t.img ?? null,
  }
}

export const sportsDataService = {
  supportedSports(): LeagueSport[] {
    return [...SUPPORTED_SPORTS]
  },

  async getTeamsBySport(sportRaw: string): Promise<SportsDataTeam[]> {
    const sport = parseLeagueSport(sportRaw)
    if (!sport) return []
    if (sport === 'NFL') {
      const teams = await fetchNFLTeams()
      return teams.map(nflRiTeamToSportsDataTeam)
    }
    const teams = await fetchRITeams(sport)
    return teams.map((t) => toSportsDataTeam(t, sport))
  },

  async getSchedulesBySport(
    sportRaw: string,
    opts?: { limit?: number; season?: string }
  ): Promise<RIScheduleGame[]> {
    const sport = parseLeagueSport(sportRaw)
    if (!sport) return []
    if (sport === 'NFL') {
      return fetchNFLSchedule({ limit: opts?.limit, season: opts?.season })
    }
    const prefix = RI_PREFIX[sport]
    const args: string[] = []
    if (opts?.season) args.push(`season: "${opts.season}"`)
    if (opts?.limit != null) args.push(`limit: ${opts.limit}`)
    const argsStr = args.length ? `(${args.join(', ')})` : ''
    const field = `${prefix}Schedules`
    const query = `{ ${field}${argsStr} { ${SCHEDULE_SUBFIELDS} } }`
    try {
      const data = await rollingInsightsGraphqlQuery<Record<string, RIScheduleGame[] | undefined>>(query)
      return data[field] ?? []
    } catch {
      return []
    }
  },

  async getRosterBySport(
    sportRaw: string,
    opts?: { season?: string; teamId?: string; playerName?: string; limit?: number }
  ): Promise<unknown[]> {
    const sport = parseLeagueSport(sportRaw)
    if (!sport) return []
    if (sport === 'NFL') {
      return fetchNFLRoster({
        season: opts?.season,
        teamId: opts?.teamId,
        playerName: opts?.playerName,
        limit: opts?.limit,
      })
    }
    const prefix = RI_PREFIX[sport]
    const args: string[] = []
    if (opts?.season) args.push(`season: "${opts.season}"`)
    if (opts?.teamId) args.push(`teamId: "${opts.teamId}"`)
    if (opts?.playerName) args.push(`playerName: ${JSON.stringify(opts.playerName)}`)
    if (opts?.limit) args.push(`limit: ${opts.limit}`)
    const argsStr = args.length ? `(${args.join(', ')})` : ''
    const field = `${prefix}Roster`
    const query = `{ ${field}${argsStr} { id player position team { id abbrv } number } }`
    try {
      const data = await rollingInsightsGraphqlQuery<Record<string, unknown[] | undefined>>(query)
      return data[field] ?? []
    } catch {
      return []
    }
  },

  /**
   * Best-effort “live” slice: recent schedule rows whose status looks in-progress.
   * RI field availability varies by sport; non-NFL may return [].
   */
  async getLiveGameBySport(sportRaw: string, limit = 10): Promise<RIScheduleGame[]> {
    const schedules = await this.getSchedulesBySport(sportRaw, { limit: Math.max(limit * 3, 15) })
    const liveish = schedules.filter((g) => {
      const s = String(g.status ?? '').toLowerCase()
      return s.includes('live') || s.includes('progress') || s.includes('q') || s.includes('half')
    })
    return liveish.slice(0, limit)
  },
}
