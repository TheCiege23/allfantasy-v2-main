import { prisma } from '@/lib/prisma'

/**
 * Leagues where we have at least one `WeeklyMatchup` row for the user’s Sleeper roster id
 * (matches `LeagueTeam.externalId` → Sleeper `roster_id`). Indicates matchup rows are synced for prep/scoring.
 */
export async function countLeaguesWithWeeklyMatchupForUserTeams(userId: string): Promise<number> {
  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId },
    select: { leagueId: true, externalId: true },
  })

  const pairs = teams
    .map((t) => (t.externalId ? { leagueId: t.leagueId, rosterId: t.externalId } : null))
    .filter((p): p is { leagueId: string; rosterId: string } => p !== null)

  if (pairs.length === 0) return 0

  const seen = new Set<string>()
  const chunkSize = 40
  for (let i = 0; i < pairs.length; i += chunkSize) {
    const chunk = pairs.slice(i, i + chunkSize)
    const rows = await prisma.weeklyMatchup.findMany({
      where: { OR: chunk.map((p) => ({ leagueId: p.leagueId, rosterId: p.rosterId })) },
      select: { leagueId: true },
    })
    for (const r of rows) seen.add(r.leagueId)
  }

  return seen.size
}
