import { prisma } from '@/lib/prisma'

/**
 * The weeks whose per-player scores are worth fetching for one Sleeper league.
 *
 * Derived from the `WeeklyMatchup` rows the league sync keeps: the frontier (the
 * earliest week whose matchups carry zero points — the week being played or
 * about to be) and the week before it (in progress on a Sunday, stat corrections
 * after). With no zero-point week, the newest week.
 *
 * Extracted from `syncConnectedSleeperLeague` so the live-game refresh and the
 * scheduled sync target the SAME weeks; two copies of this rule would drift, and
 * the one that drifted would fetch a week nothing reads.
 *
 * `externalLeagueId` is the SLEEPER league id — the space `WeeklyMatchup.leagueId`
 * and `LeaguePlayerWeeklyScore.leagueId` both use.
 */
export async function sleeperScoreTargetWeeks(externalLeagueId: string, season: number): Promise<number[]> {
  const weekRows = await prisma.weeklyMatchup.groupBy({
    by: ['week'],
    where: { leagueId: externalLeagueId, seasonYear: season },
    _sum: { pointsFor: true },
    orderBy: { week: 'asc' },
  })
  let frontier: number | null = null
  for (const r of weekRows) {
    if ((r._sum.pointsFor ?? 0) === 0) {
      frontier = r.week
      break
    }
  }
  const targetWeeks = new Set<number>()
  if (frontier !== null) {
    targetWeeks.add(frontier)
    if (frontier > 1) targetWeeks.add(frontier - 1)
  } else if (weekRows.length > 0) {
    targetWeeks.add(weekRows[weekRows.length - 1]!.week)
  }
  return [...targetWeeks]
}
