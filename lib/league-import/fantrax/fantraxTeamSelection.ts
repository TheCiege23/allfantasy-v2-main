import type { FantraxLeagueSummary } from './fantraxApi'

export type FantraxTeamSelection = {
  leagueId: string
  teamId?: string
  teamName?: string
}

/** Team IDs survive renames; names remain accepted for older import links. */
export function parseFantraxTeamSourceId(sourceId: string): FantraxTeamSelection | null {
  const match = sourceId.trim().match(/^fantrax-league:([^|]+)\|(.+)$/i)
  if (!match?.[1] || !match[2]) return null
  const leagueId = match[1].trim()
  const selector = match[2].trim()
  if (!leagueId || !selector) return null
  if (!selector.startsWith('team-id:')) return { leagueId, teamName: selector }
  try {
    const teamId = decodeURIComponent(selector.slice('team-id:'.length))
    return teamId ? { leagueId, teamId } : null
  } catch {
    return null
  }
}

export function fantraxTeamSourceId(leagueId: string, teamId: string): string {
  return `fantrax-league:${leagueId}|team-id:${encodeURIComponent(teamId)}`
}

export function listFantraxOwnedTeams(league: FantraxLeagueSummary): Array<{
  teamId?: string
  teamName: string
  sourceId: string
}> {
  return Array.from({ length: Math.max(league.teamIds.length, league.teamNames.length) }, (_, index) => {
    const teamId = league.teamIds[index]?.trim()
    const teamName = league.teamNames[index]?.trim() || teamId || ''
    return {
      teamId,
      teamName,
      sourceId: teamId
        ? fantraxTeamSourceId(league.leagueId, teamId)
        : `fantrax-league:${league.leagueId}|${teamName}`,
    }
  }).filter((team) => team.teamName)
}

/** Returns the current team name only when the linked Fantrax account owns it. */
export function ownedFantraxTeamName(
  leagues: FantraxLeagueSummary[],
  selection: FantraxTeamSelection,
): string | null {
  const league = leagues.find((item) => item.leagueId === selection.leagueId)
  if (!league) return null
  const teams = listFantraxOwnedTeams(league)
  const owned = selection.teamId
    ? teams.find((team) => team.teamId === selection.teamId)
    : teams.find((team) => team.teamName.toLowerCase() === selection.teamName?.trim().toLowerCase())
  return owned?.teamName ?? null
}

export function selectFantraxRoster<T extends { teamId: string; teamName: string }>(
  rosters: T[],
  selection: Pick<FantraxTeamSelection, 'teamId' | 'teamName'>,
): T | undefined {
  if (selection.teamId) return rosters.find((roster) => roster.teamId === selection.teamId)
  const name = selection.teamName?.trim().toLowerCase()
  return name ? rosters.find((roster) => roster.teamName.toLowerCase() === name) : undefined
}
