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
  /**
   * The league is official on AllFantasy, so AllFantasy keeps every team's record (rule 3: AllFantasy
   * scoring is official) and the re-sync must not write the platform's over it, switched or not.
   */
  official?: boolean
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
    return { externalIds, teamIds, official: true }
  } catch (err) {
    console.warn('[switching] could not read switched teams; re-sync writes every team', {
      leagueId,
      error: err instanceof Error ? err.message : String(err),
    })
    return none
  }
}

/**
 * Which redraft rosters belong to a team AllFantasy runs. A redraft roster reaches its team only through
 * the legacy `Roster` row (`Roster.redraftRosterId`, then `playerData.source_team_id` =
 * `LeagueTeam.externalId`); a redraft roster with no such link is read as NOT run here, the safe side for
 * every caller below.
 */
export async function redraftRosterIdsRunOnAllFantasy(leagueId: string, externalIds: Set<string>): Promise<Set<string>> {
  if (externalIds.size === 0) return new Set()
  const rosters = await prisma.roster.findMany({
    where: { leagueId, redraftRosterId: { not: null } },
    select: { redraftRosterId: true, playerData: true },
  })
  const out = new Set<string>()
  for (const r of rosters) {
    const pd = r.playerData && typeof r.playerData === 'object' ? (r.playerData as Record<string, unknown>) : {}
    if (r.redraftRosterId && externalIds.has(String(pd.source_team_id ?? ''))) out.add(r.redraftRosterId)
  }
  return out
}

/**
 * The teams in a trade that AllFantasy does not run: in a league made official here, every team whose
 * manager has not switched. Empty for every league that is not official, so trades there work exactly as
 * before.
 *
 * Not wrapped in a catch on purpose. A trade that cannot tell whether a team switched must not go
 * through: it would move players on AllFantasy that the old platform still places on the other roster.
 */
export async function tradeTeamsNotOnAllFantasy(
  leagueId: string,
  redraftRosterIds: readonly string[],
): Promise<Array<{ rosterId: string; name: string }>> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league || !isOfficialOnAllFantasy(league.settings)) return []
  const teams = await prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, externalId: true } })
  const runHere = await redraftRosterIdsRunOnAllFantasy(leagueId, teamsRunOnAllFantasy(league.settings, teams))
  const missing = [...new Set(redraftRosterIds)].filter((id) => !runHere.has(id))
  if (missing.length === 0) return []
  const rows = await prisma.redraftRoster.findMany({ where: { id: { in: missing } }, select: { id: true, teamName: true, ownerName: true } })
  const names = new Map(rows.map((r) => [r.id, r.teamName?.trim() || r.ownerName?.trim() || 'A team']))
  return missing.map((id) => ({ rosterId: id, name: names.get(id) ?? 'A team' }))
}

/**
 * The same answer for the league trade engine (lib/league-trade-engine), whose teams are legacy `Roster`
 * rows: a roster is run here when its `playerData.source_team_id` is a switched team's platform id.
 */
export async function leagueTradeTeamsNotOnAllFantasy(
  leagueId: string,
  rosterIds: readonly string[],
): Promise<Array<{ rosterId: string; name: string }>> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league || !isOfficialOnAllFantasy(league.settings)) return []
  const teams = await prisma.leagueTeam.findMany({ where: { leagueId }, select: { id: true, externalId: true, teamName: true } })
  const switched = teamsRunOnAllFantasy(league.settings, teams)
  const rosters = await prisma.roster.findMany({ where: { id: { in: [...new Set(rosterIds)] }, leagueId }, select: { id: true, playerData: true } })
  const byId = new Map(rosters.map((r) => {
    const pd = r.playerData && typeof r.playerData === 'object' ? (r.playerData as Record<string, unknown>) : {}
    return [r.id, String(pd.source_team_id ?? '')]
  }))
  const nameOf = new Map(teams.map((t) => [t.externalId ?? '', t.teamName?.trim() || 'A team']))
  return [...new Set(rosterIds)]
    .filter((id) => !switched.has(byId.get(id) ?? ''))
    .map((id) => ({ rosterId: id, name: nameOf.get(byId.get(id) ?? '') ?? 'A team' }))
}
