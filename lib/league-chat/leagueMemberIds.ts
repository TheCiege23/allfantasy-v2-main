import 'server-only'

import { prisma } from '@/lib/prisma'
import { ACTIVE_TEAM_WHERE } from '@/lib/league-import/activeTeams'

/** User ids with a team claim in the league, plus the league owner (commissioner import user). */
export async function getLeagueMemberUserIds(leagueId: string): Promise<string[]> {
  const [teams, league] = await Promise.all([
    prisma.leagueTeam.findMany({
      /* Chat membership is CURRENT membership — an archived seat's claimer leaves the room. */
      where: { ...ACTIVE_TEAM_WHERE, leagueId, claimedByUserId: { not: null } },
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
