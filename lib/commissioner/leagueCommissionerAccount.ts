/**
 * Whose ACCOUNT stands for a league's commissioner — for plan checks and "act as the commissioner".
 *
 * For almost every league that is the owner (`League.userId`), which is what these callers have
 * always read. The exception is a league owned by the AllFantasy SYSTEM account: a public ESPN
 * league people joined by picking a team (`lib/league-import/systemLeagueOwner.ts`). Its owner is
 * not a person and has no plan, so reading `League.userId` locked a real, paying commissioner out
 * of every paid commissioner feature.
 *
 * For those leagues the commissioner account is whoever holds the team ESPN flags as league manager
 * (`LeagueTeam.isCommissioner`) with a CONFIRMED claim — proven with their own ESPN cookies.
 *
 * 🛑 NEVER an unconfirmed claim. A picked team proves nothing, and `isConfirmed: false` is exactly
 * "picked, not proven" (see `lib/league-import/espn/espnPublicMemberImport.ts`). `null` means the
 * league has no proven commissioner yet; callers must treat that as "not entitled", which is what
 * reading the system account always produced.
 */
import { prisma } from '@/lib/prisma'
import { isSystemLeagueOwner } from '@/lib/league-import/systemLeagueOwner'
import { isCommissioner } from '@/lib/commissioner/permissions'

/**
 * The check the commissioner routes made with `league.userId === session.user.id`, widened to the
 * shared rule in `lib/commissioner/permissions.ts`: the owner, OR the holder of the team the source
 * platform flags as head commissioner. The owner short-circuit keeps the common case at zero extra
 * queries. ⚠ FAILS CLOSED: a read that throws is "not the commissioner", never a 500 or a pass.
 */
export async function isOwnerOrLeagueCommissioner(
  league: { userId: string | null } | null | undefined,
  leagueId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false
  if (league?.userId && league.userId === userId) return true
  try {
    return await isCommissioner(leagueId, userId)
  } catch {
    return false
  }
}

export async function leagueCommissionerAccountId(
  leagueId: string,
  ownerUserId: string | null | undefined,
): Promise<string | null> {
  if (!ownerUserId) return null
  if (!isSystemLeagueOwner(ownerUserId)) return ownerUserId
  return provenClaimedCommissionerId(leagueId)
}

/** The confirmed claimant of the team ESPN flags as head commissioner, if any. */
export async function provenClaimedCommissionerId(leagueId: string): Promise<string | null> {
  try {
    const teams = (await prisma.leagueTeam.findMany({
      where: { leagueId, isCommissioner: true, claimedByUserId: { not: null } },
      select: { claimedByUserId: true, externalId: true },
    })) as Array<{ claimedByUserId: string | null; externalId: string }>
    for (const team of teams) {
      if (!team.claimedByUserId || isSystemLeagueOwner(team.claimedByUserId)) continue
      const claim = await prisma.leagueManagerClaim.findFirst({
        where: { leagueId, afUserId: team.claimedByUserId, teamExternalId: team.externalId, isConfirmed: true },
        select: { id: true },
      })
      if (claim) return team.claimedByUserId
    }
  } catch {
    // Fail closed: no proven commissioner means no entitlement, the same as before this existed.
  }
  return null
}
