/**
 * Who may use a Zombie universe's routes.
 *
 * - Owner: `commissionedByUserId ?? createdByUserId`, the rule the universe chat, invite and
 *   draft-schedule routes already apply inline.
 * - Member: the owner, the commissioner (`League.userId`) of any league in the universe, or a user
 *   with a roster in one. That is the membership `/api/zombie-universe` uses to list a user's
 *   universes.
 */

import { prisma } from '@/lib/prisma'

export type ZombieUniverseAccess = {
  exists: boolean
  isOwner: boolean
  isMember: boolean
}

export async function resolveZombieUniverseAccess(universeId: string, userId: string): Promise<ZombieUniverseAccess> {
  const universe = await prisma.zombieUniverse.findUnique({
    where: { id: universeId },
    select: {
      commissionedByUserId: true,
      createdByUserId: true,
      leagues: { select: { leagueId: true } },
    },
  })
  if (!universe) return { exists: false, isOwner: false, isMember: false }

  const ownerId = universe.commissionedByUserId ?? universe.createdByUserId ?? null
  if (ownerId != null && ownerId === userId) return { exists: true, isOwner: true, isMember: true }

  const leagueIds = universe.leagues.map((league) => league.leagueId)
  if (leagueIds.length === 0) return { exists: true, isOwner: false, isMember: false }

  const [commissioned, roster] = await Promise.all([
    prisma.league.findFirst({ where: { id: { in: leagueIds }, userId }, select: { id: true } }),
    prisma.roster.findFirst({ where: { leagueId: { in: leagueIds }, platformUserId: userId }, select: { id: true } }),
  ])
  return { exists: true, isOwner: false, isMember: commissioned != null || roster != null }
}
