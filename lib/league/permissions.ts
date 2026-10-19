import { seasonSetupBlocked } from '@/lib/tournament/seasonNativeContract'
import { prisma } from '@/lib/prisma'
import { isTournamentCoCommissioner } from '@/lib/league/tournamentCoCommissioners'

export type LeagueRole = 'commissioner' | 'co_commissioner' | 'member' | 'viewer' | null

/**
 * Returns the role of userId in leagueId.
 * Head commissioner is always the AllFantasy league owner (`League.userId`), regardless of imported Sleeper flags.
 * A co-commissioner granted by the tournament that created the league (see ./tournamentCoCommissioners)
 * is `co_commissioner` whether or not they hold a team in it.
 */
export async function getLeagueRole(leagueId: string, userId: string): Promise<LeagueRole> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true, settings: true },
  })
  if (!league) return null
  if (league.userId === userId) return 'commissioner'
  const tournamentCoCommissioner = isTournamentCoCommissioner(league.settings, userId)

  const team = await prisma.leagueTeam.findFirst({
    where: {
      leagueId,
      claimedByUserId: userId,
    },
    select: {
      isCommissioner: true,
      isCoCommissioner: true,
      role: true,
    },
  })

  if (team) {
    if (team.role === 'viewer') return 'viewer'
    if (team.isCommissioner) return 'commissioner'
    if (team.isCoCommissioner || tournamentCoCommissioner) return 'co_commissioner'
    return 'member'
  }
  if (tournamentCoCommissioner) return 'co_commissioner'

  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  if (roster) return 'member'

  return null
}

/**
 * Head commissioner or co-commissioner — the roles that run a league. The one rule behind
 * `requireCommissionerRole`, exported for callers that need a yes/no rather than a thrown 403
 * (a screen deciding what to show must agree with the route that will accept the write).
 */
export function isCommissionerRole(role: LeagueRole): role is 'commissioner' | 'co_commissioner' {
  return role === 'commissioner' || role === 'co_commissioner'
}

/**
 * Yes/no: may userId act as commissioner or co-commissioner of leagueId? The league owner, anyone
 * holding a team flagged `isCommissioner` / `isCoCommissioner`, or a co-commissioner granted by the
 * tournament that created the league (./tournamentCoCommissioners — no team needed).
 *
 * One read. It is the check the redraft commissioner routes each carried a private copy of, with the
 * tournament list added; unlike `getLeagueRole` it looks at EVERY team the user holds, as those
 * copies did, so moving them here narrows nobody. Co-commissioner rights only — no team, no seat.
 */
export async function hasLeagueCommissionerRights(leagueId: string, userId: string): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      userId: true,
      settings: true,
      teams: { where: { claimedByUserId: userId }, select: { isCommissioner: true, isCoCommissioner: true } },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  const teams = (league.teams ?? []) as { isCommissioner: boolean; isCoCommissioner: boolean }[]
  if (teams.some((t) => t.isCommissioner || t.isCoCommissioner)) return true
  return isTournamentCoCommissioner(league.settings, userId)
}

/**
 * Throws a 403 Response if userId is not commissioner or co-commissioner
 * of leagueId. Use this at the top of every settings API route.
 */
export async function requireCommissionerRole(leagueId: string, userId: string): Promise<void> {
  const league = await prisma.league.findFirst({ where: { id: leagueId }, select: { settings: true } })
  if (seasonSetupBlocked(league?.settings)) throw new Response(JSON.stringify({ error: 'Tournament settings are frozen while setup is completed.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
  const role = await getLeagueRole(leagueId, userId)
  if (!isCommissionerRole(role)) {
    throw new Response(
      JSON.stringify({ error: 'Only the commissioner can change league settings.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

/**
 * Same as requireCommissionerRole but ONLY allows commissioner (not co-comm).
 * Use for destructive actions like Reset Draft and co-commissioner management.
 */
export async function requireCommissionerOnly(leagueId: string, userId: string): Promise<void> {
  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner') {
    throw new Response(
      JSON.stringify({ error: 'Only the head commissioner can perform this action.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
