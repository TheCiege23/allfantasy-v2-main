import { prisma } from '@/lib/prisma'

/**
 * Commissioner = the league owner (`League.userId`), OR the user whose claimed team in this
 * league is the source platform's head commissioner (`LeagueTeam.isCommissioner`, not a viewer).
 * Do not use for admin-only controls; commissioners are scoped to their league.
 *
 * 🛑 WHY THE SECOND HALF EXISTS. An imported league's `League.userId` is whoever imported it
 * first. When the real source commissioner imports the same league later, the import attaches
 * them to their own team in THAT league (`claimExistingLeagueForMember`), a team the provider
 * marked `isCommissioner`. `lib/league/permissions.ts getLeagueRole` already reads that as
 * 'commissioner'; this module did not, so every one of its ~118 callers 403'd the actual
 * commissioner of the league.
 *
 * ⚠ HEAD COMMISSIONER ONLY. `isCoCommissioner` is deliberately NOT admitted: co-commissioners
 * get their narrower rights through `requireCommissionerRole` in the settings routes, and
 * widening this module would hand them every commissioner-only action at once.
 */

/** Claimed team in this league that the source platform marked as its head commissioner. */
async function hasClaimedCommissionerTeam(leagueId: string, userId: string): Promise<boolean> {
  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId, claimedByUserId: userId, isCommissioner: true, role: { not: 'viewer' } },
    select: { isCommissioner: true, role: true },
  })
  // Re-checked here, not only in `where`: this is a permission, and a query that loses a
  // filter (or a caller's stub that ignores one) must fail closed.
  return team?.isCommissioner === true && team.role !== 'viewer'
}

export async function isCommissioner(leagueId: string, userId: string | undefined): Promise<boolean> {
  if (!userId) return false
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { userId: true },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return hasClaimedCommissionerTeam(leagueId, userId)
}

export async function getLeagueIfCommissioner(leagueId: string, userId: string | undefined) {
  if (!userId) return null
  // Owner first: one query, the common case, and the same row shape as before.
  const owned = await prisma.league.findFirst({
    where: { id: leagueId, userId },
  })
  if (owned) return owned
  if (!(await hasClaimedCommissionerTeam(leagueId, userId))) return null
  return prisma.league.findFirst({
    where: { id: leagueId },
  })
}

/**
 * Throws if not commissioner. Use in API routes after getServerSession.
 */
export async function assertCommissioner(leagueId: string, userId: string | undefined): Promise<{ league: NonNullable<Awaited<ReturnType<typeof getLeagueIfCommissioner>>> }> {
  const league = await getLeagueIfCommissioner(leagueId, userId)
  if (!league) {
    const err = new Error('Forbidden') as Error & { status?: number }
    err.status = 403
    throw err
  }
  return { league }
}
