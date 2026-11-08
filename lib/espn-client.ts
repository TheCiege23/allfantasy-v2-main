/**
 * Legacy stateless ESPN read for `/api/legacy/espn-import` (guest trial funnel) and the redraft
 * provider wiring. HTTP and the id tables are shared with the importer — see
 * `lib/league-import/espn/espnFantasyClient.ts` and `espnLookups.ts` — so this file only shapes the
 * response. Output labels are kept exactly as this route has always returned them ('DEF', 'UNK').
 */
import { EspnApiResponseError, fetchEspnLeagueJson } from '@/lib/league-import/espn/espnFantasyClient'
import { classifyEspnLineupSlot, espnPositionLabel, espnProTeamAbbreviation } from '@/lib/league-import/espn/espnLookups'

function legacyPositionLabel(positionId: unknown): string {
  const label = espnPositionLabel(positionId, 'UNK')
  return label === 'D/ST' ? 'DEF' : label
}

export type EspnTeam = {
  id: number
  name: string
  abbrev: string
  owners: string[]
  record: { wins: number; losses: number; ties: number; pointsFor: number }
  roster: EspnRosterEntry[]
}

export type EspnRosterEntry = {
  playerId: number
  name: string
  position: string
  nflTeam: string
  slot: 'Starter' | 'Bench' | 'IR'
}

export type EspnLeagueData = {
  leagueId: number
  leagueName: string
  seasonId: number
  numTeams: number
  scoringType: string
  teams: EspnTeam[]
}

async function fetchEspnJson(leagueId: string, season: number): Promise<any> {
  try {
    return await fetchEspnLeagueJson({ game: 'ffl', season, leagueId, views: ['mRoster', 'mTeam', 'mSettings'] })
  } catch (error) {
    if (error instanceof EspnApiResponseError) {
      if (error.status === 404) throw new Error('League not found. Make sure the league ID is correct and the league is public.')
      if (error.status === 401 || error.status === 403) throw new Error('This league is private. Go to ESPN League Settings and enable "Make League Viewable to Public".')
    }
    throw error
  }
}

function detectScoringType(scoringItems: any[]): string {
  const recItem = scoringItems.find((i: any) => i.statId === 53)
  if (!recItem) return 'Standard'
  const pts = recItem.points || 0
  if (pts >= 1) return 'PPR'
  if (pts >= 0.5) return 'Half PPR'
  return 'Standard'
}

function slotToRosterSlot(slotId: number): 'Starter' | 'Bench' | 'IR' {
  const placement = classifyEspnLineupSlot(slotId)
  return placement === 'ir' ? 'IR' : placement === 'bench' ? 'Bench' : 'Starter'
}

export async function fetchEspnLeague(leagueId: string | number, season?: number): Promise<EspnLeagueData> {
  const yr = season || new Date().getFullYear()
  const data = await fetchEspnJson(String(leagueId), yr)

  const settings = data.settings || {}
  const leagueName = settings.name || `ESPN League ${leagueId}`
  const numTeams = settings.size || (data.teams || []).length
  const scoringType = detectScoringType(settings.scoringSettings?.scoringItems || [])

  const teams: EspnTeam[] = (data.teams || []).map((t: any) => {
    const overall = t.record?.overall || {}
    const roster: EspnRosterEntry[] = (t.roster?.entries || []).map((e: any) => {
      const player = e.playerPoolEntry?.player || {}

      return {
        playerId: e.playerId,
        name: player.fullName || `Player ${e.playerId}`,
        position: legacyPositionLabel(player.defaultPositionId),
        nflTeam: espnProTeamAbbreviation(player.proTeamId),
        slot: slotToRosterSlot(e.lineupSlotId ?? 20),
      }
    })

    return {
      id: t.id,
      name: t.name || t.abbrev || `Team ${t.id}`,
      abbrev: t.abbrev || '',
      owners: t.owners || [],
      record: {
        wins: overall.wins || 0,
        losses: overall.losses || 0,
        ties: overall.ties || 0,
        pointsFor: overall.pointsFor || 0,
      },
      roster,
    }
  })

  return {
    leagueId: Number(leagueId),
    leagueName,
    seasonId: yr,
    numTeams,
    scoringType,
    teams,
  }
}

export function findTeamByName(teams: EspnTeam[], teamName: string): EspnTeam | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/['']/g, "'")
  const target = norm(teamName)
  return (
    teams.find(t => norm(t.name) === target) ||
    teams.find(t => norm(t.name).includes(target) || target.includes(norm(t.name))) ||
    teams.find(t => norm(t.abbrev) === target)
  )
}
