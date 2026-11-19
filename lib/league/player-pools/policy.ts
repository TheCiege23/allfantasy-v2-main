import { readDivisionConfig } from '@/lib/league/divisions/leagueDivisions'

export const PLAYER_POOL_SCOPES = ['league', 'conference', 'division'] as const
export type PlayerPoolScope = typeof PLAYER_POOL_SCOPES[number]
export type PlayerPools = Record<string, string> | null

export function readPlayerPoolScope(settings: unknown): PlayerPoolScope {
  const scope = (settings as { player_pool_scope?: unknown } | null)?.player_pool_scope
  return scope === 'division' || scope === 'conference' ? scope : 'league'
}

export function poolOf(pools: PlayerPools, rosterId: string): string {
  if (!pools) return 'league'
  const pool = pools[rosterId]
  if (!pool) throw new Error('Assign this team to a player pool in commissioner division settings.')
  return pool
}

export function picksInPool<T extends { rosterId: string }>(picks: readonly T[], pools: PlayerPools, rosterId: string): readonly T[] {
  if (!pools) return picks
  const pool = poolOf(pools, rosterId)
  return picks.filter(p => poolOf(pools, p.rosterId) === pool)
}

export function teamPoolResolver(settings: unknown): (teamId: string) => string {
  const scope = readPlayerPoolScope(settings)
  const assignments = readDivisionConfig(settings).teamAssignments
  return (teamId) => {
    if (scope === 'league') return scope
    const division = assignments[teamId]
    if (division === undefined) throw new Error('Assign every team to a division before using separate player pools.')
    if (scope === 'division') return 'division-' + division
    const conference = (settings as { division_conferences?: number[] }).division_conferences?.[division]
    if (conference === undefined || !Number.isInteger(conference) || conference < 0) throw new Error('Assign every division to a conference before using conference player pools.')
    return 'conference-' + conference
  }
}

export function poolSetupError(scope: unknown, divisions: number, conferences: unknown, teamCount: number): string | null {
  if (!PLAYER_POOL_SCOPES.includes(scope as PlayerPoolScope)) return 'Choose a league, conference or division player pool.'
  if (scope === 'league') return null
  if (!Number.isInteger(divisions) || divisions < 2 || divisions > Math.min(32, Math.floor(teamCount / 2))) return 'Choose 2–32 divisions with at least two teams per division.'
  if (scope === 'conference' && (!Array.isArray(conferences) || conferences.length !== divisions || conferences.some(c => !Number.isInteger(c) || c < 0 || c >= divisions) || new Set(conferences).size < 2)) return 'Assign each division to one of at least two conferences.'
  return null
}

export function startingPoolLayout(scope: PlayerPoolScope, divisions: number, conferenceCount: number, orderedTeamIds: string[]) {
  const conferences = Array.from({length:divisions}, (_, i) => i % conferenceCount)
  const error = poolSetupError(scope, divisions, conferences, orderedTeamIds.length)
  if (error || (scope === 'conference' && (!Number.isInteger(conferenceCount) || conferenceCount < 2 || conferenceCount > divisions))) throw new Error(error ?? 'Choose between two conferences and the number of divisions.')
  return {player_pool_scope: scope, division_conferences: conferences, num_divisions: divisions, division_config: {
    count: divisions, names: Array.from({length: divisions}, (_,i) => 'Division ' + (i+1)),
    teamAssignments: Object.fromEntries(orderedTeamIds.map((id,i) => [id, i % divisions])),
    aiNamingEnabled: false, playoffRule: 'top_seeds', rivalsTwice: false,
  }}
}
