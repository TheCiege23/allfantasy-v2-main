import { prisma } from '@/lib/prisma'

export type LeagueRole = 'commissioner' | 'co_commissioner' | 'member' | 'viewer' | null

/**
 * Returns the role of userId in leagueId.
 * Head commissioner is always the AllFantasy league owner (`League.userId`), regardless of imported Sleeper flags.
 */
export async function getLeagueRole(leagueId: string, userId: string): Promise<LeagueRole> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true },
  })
  if (!league) return null
  if (league.userId === userId) return 'commissioner'

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
    if (team.isCoCommissioner) return 'co_commissioner'
    return 'member'
  }

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
 * Throws a 403 Response if userId is not commissioner or co-commissioner
 * of leagueId. Use this at the top of every settings API route.
 */
export async function requireCommissionerRole(leagueId: string, userId: string): Promise<void> {
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
