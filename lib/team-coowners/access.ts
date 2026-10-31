import { prisma } from '@/lib/prisma'

/** A staged deployment may briefly run before the additive table exists; fail closed. */
export function coOwnerTableMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2021'
}

/** An accepted team invitation grants roster access, never commissioner access. */
export async function acceptedCoOwnerRosterId(leagueId: string, userId: string): Promise<string | null> {
  if (!leagueId || !userId) return null
  const row = await prisma.teamCoOwner?.findUnique({
    where: { leagueId_userId: { leagueId, userId } },
    select: { rosterId: true, acceptedAt: true, rosterOwnerKey: true, claimedOwnerId: true, roster: { select: { leagueId: true, platformUserId: true } } },
  }).catch((error: unknown) => { if (coOwnerTableMissing(error)) return null; throw error })
  if (!row?.acceptedAt || row.roster.leagueId !== leagueId || row.roster.platformUserId !== row.rosterOwnerKey) return null
  const currentTeam = await prisma.leagueTeam.findFirst({ where: { leagueId, externalId: row.rosterId }, select: { claimedByUserId: true } })
  if ((currentTeam?.claimedByUserId ?? null) !== row.claimedOwnerId) return null
  // A user who has since claimed a team cannot manage a second team's roster.
  const [primary, claimedTeam] = await Promise.all([
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
    prisma.leagueTeam.findFirst({ where: { leagueId, claimedByUserId: userId }, select: { id: true } }),
  ])
  if (primary || claimedTeam) return null
  return row.rosterId
}

export async function isAcceptedCoOwnerForRoster(leagueId: string, rosterId: string, userId: string): Promise<boolean> {
  return (await acceptedCoOwnerRosterId(leagueId, userId)) === rosterId
}

/** Use the explicit mapping only; a co-owner must never gain access to a namesake roster. */
export async function isAcceptedCoOwnerForRedraftRoster(leagueId: string, redraftRosterId: string, userId: string): Promise<boolean> {
  const canonicalId = await acceptedCoOwnerRosterId(leagueId, userId)
  if (!canonicalId) return false
  const roster = await prisma.roster.findFirst({
    where: { id: canonicalId, leagueId, redraftRosterId },
    select: { id: true },
  })
  return Boolean(roster)
}
