import 'server-only'

import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'
import { IMPORT_CO_COMMISSIONERS_KEY, TOURNAMENT_CO_COMMISSIONERS_KEY } from '@/lib/league/tournamentCoCommissioners'

/** List candidates in one query and use the same read role as the per-league Hub for delegated access. */
export async function listManagedLeagues(userId: string, leagueIds: string[]) {
  if (leagueIds.length === 0) return []
  const rows = await prisma.league.findMany({
    where: {
      id: { in: leagueIds },
      OR: [
        { userId },
        { teams: { some: { claimedByUserId: userId, OR: [{ isCommissioner: true }, { isCoCommissioner: true }] } } },
        { settings: { path: [IMPORT_CO_COMMISSIONERS_KEY], array_contains: [userId] } },
        { settings: { path: [TOURNAMENT_CO_COMMISSIONERS_KEY], array_contains: [userId] } },
      ],
    },
    select: { id: true, userId: true, platform: true },
  })
  const allowed = await Promise.all(rows.map(async (row) => (
    row.userId === userId || isCommissionerRole(await getLeagueRole(row.id, userId)) ? row : null
  )))
  return allowed.flatMap((row) => row ? [{ id: row.id, native: isNativePlatform(row.platform) }] : [])
}

export async function readManagerSeats(leagueIds: string[]) {
  if (leagueIds.length === 0) return new Map<string, { total: number; claimed: number }>()
  const counts = await prisma.leagueTeam.groupBy({
    by: ['leagueId'],
    where: { leagueId: { in: leagueIds } },
    _count: { _all: true, claimedByUserId: true },
  })
  return new Map(counts.map((row) => [row.leagueId, { total: row._count._all, claimed: row._count.claimedByUserId }]))
}
