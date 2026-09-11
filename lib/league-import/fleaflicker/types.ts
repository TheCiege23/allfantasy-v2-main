import type { ResourceFetchStatus } from '@/lib/league-import/resourceStatus'
/**
 * Minimal shapes for Fleaflicker public API (`FetchLeagueStandings`, `FetchLeagueRosters`).
 * Full API surface: https://www.fleaflicker.com/api-docs/index.html
 */

export type FleaflickerSport = 'NFL' | 'MLB' | 'NBA' | 'NHL'

export type FleaflickerProPlayer = {
  id: number
  nameFull?: string
  position?: string
  nameShort?: string
}

export type FleaflickerRosterPlayer = {
  proPlayer: FleaflickerProPlayer
}

export type FleaflickerTeamStub = {
  id: number
  name: string
  logoUrl?: string | null
  waiverAcquisitionBudget?: { value?: number } | null
  recordOverall?: { wins?: number; losses?: number; ties?: number }
  pointsFor?: { value?: number }
  pointsAgainst?: { value?: number }
  owners?: Array<{ id: number; displayName?: string }>
  initials?: string
}

export type FleaflickerLeagueCore = {
  id: number
  name: string
  logoUrl?: string | null
  description?: string | null
  size?: number
  capacity?: number
  maxKeepers?: number | null
  waiverType?: string | null
  defaultWaiverBudget?: number | null
  rosterRequirements?: {
    rosterSize?: number
    positions?: Array<{ label?: string; group?: string; start?: number }>
  }
}

export type FleaflickerStandingsResponse = {
  season: number
  league: FleaflickerLeagueCore
  divisions: Array<{
    id: number
    name: string
    teams: FleaflickerTeamStub[]
  }>
}

export type FleaflickerRostersResponse = {
  rosters: Array<{
    team: FleaflickerTeamStub
    players: FleaflickerRosterPlayer[]
  }>
}

export type FleaflickerImportPayload = {
  sport: FleaflickerSport
  season: number
  standings: FleaflickerStandingsResponse
  rosters: FleaflickerRostersResponse
  /**
   * What actually happened on the roster request — IMP-04.
   *
   * 🛑 THE FETCHER USED TO SWALLOW THIS WITH `.catch(() => ({ rosters: [] }))`, which is the
   * same defect as Yahoo's: a timed-out roster read became "every team has nobody", and the
   * adapter had no way to tell that from a genuinely pre-draft league.
   */
  rostersStatus: ResourceFetchStatus
}
