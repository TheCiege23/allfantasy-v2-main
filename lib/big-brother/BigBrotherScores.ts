import { prisma } from '@/lib/prisma'

/** Actual finalized scores for the league's season. Missing/active scores never become zero. */
export async function getBigBrotherWeeklyScores(leagueId: string, week: number): Promise<Record<string, number>> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (!league) return {}
  const results = await prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season, week, status: 'final' }, select: { rosterId: true, totalPoints: true } })
  return Object.fromEntries(results.filter(r => Number.isFinite(r.totalPoints)).map(r => [r.rosterId, r.totalPoints]))
}

export async function getBigBrotherSeasonPoints(leagueId: string, rosterId: string, throughWeek: number): Promise<number> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (!league) return 0
  const rows = await prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season, rosterId, week: { lte: throughWeek }, status: 'final' }, select: { totalPoints: true } })
  return rows.reduce((sum, row) => sum + (Number.isFinite(row.totalPoints) ? row.totalPoints : 0), 0)
}
