import 'server-only'

import { prisma } from '@/lib/prisma'

/** User ids with a team claim in the league, plus the league owner (commissioner import user). */
export async function getLeagueMemberUserIds(leagueId: string): Promise<string[]> {
  const [teams, league] = await Promise.all([
    prisma.leagueTeam.findMany({
      /* Keyed on the claim. Suppressing a DEPARTED claimer needs the lifecycle axis; the
       * `isOrphan` flag cannot say it, because it also means vacant, eliminated and removed. */
      where: { leagueId, claimedByUserId: { not: null } },
      select: { claimedByUserId: true },
    }),
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { userId: true },
    }),
  ])
  const ids = new Set<string>()
  for (const t of teams) {
    if (t.claimedByUserId) ids.add(t.claimedByUserId)
  }
  if (league?.userId) ids.add(league.userId)
  return [...ids]
}
