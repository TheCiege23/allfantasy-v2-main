/**
 * Server-side read for the re-sync: which of this league's teams AllFantasy runs (switched teams in an
 * official league), by platform team id and by `LeagueTeam.id`. See `teamsRunOnAllFantasy`.
 */
import { prisma } from '@/lib/prisma'
import { isOfficialOnAllFantasy, teamsRunOnAllFantasy } from './switchingLeague'

export type TeamsRunOnAllFantasy = {
  /** `LeagueTeam.externalId` (the import's `source_team_id`). */
  externalIds: Set<string>
  /** `LeagueTeam.id`. */
  teamIds: Set<string>
}

/**
 * A failed read answers "none", which is today's behaviour: the re-sync writes every team. It is
 * logged rather than thrown because this sits at the top of every re-sync, and a read that fails here
 * means the sync's own reads of the same rows are failing too.
 */
export async function loadTeamsRunOnAllFantasy(leagueId: string): Promise<TeamsRunOnAllFantasy> {
  const none: TeamsRunOnAllFantasy = { externalIds: new Set(), teamIds: new Set() }
  try {
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    // Every league that is not official stops here, with no team query.
    if (!league || !isOfficialOnAllFantasy(league.settings)) return none
    const teams = await prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, externalId: true } })
    const externalIds = teamsRunOnAllFantasy(league.settings, teams)
    const teamIds = new Set(teams.filter((t) => t.externalId && externalIds.has(t.externalId)).map((t) => t.id))
    return { externalIds, teamIds }
  } catch (err) {
    console.warn('[switching] could not read switched teams; re-sync writes every team', {
      leagueId,
      error: err instanceof Error ? err.message : String(err),
    })
    return none
  }
}
