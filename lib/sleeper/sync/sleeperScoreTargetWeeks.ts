import { prisma } from '@/lib/prisma'
import { readLeagueWeekMetadata } from '@/lib/core-app/leagueWeekMetadata'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'

/**
 * The weeks whose per-player scores are worth fetching for one Sleeper league.
 *
 * Prefer the saved provider period and previous week for current scoring and corrections.
 * Without a provider period, derive from the `WeeklyMatchup` rows: the frontier (the
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
  const metadata = await readLeagueWeekMetadata([externalLeagueId], 'platform')
  const league = metadata.find((row) => row.season === season)
  const currentWeek = leagueWeekFromSettings(league?.settings)
  if (currentWeek != null && !['complete', 'completed', 'finished'].includes(String(league?.status ?? '').toLowerCase())) {
    return currentWeek > 1 ? [currentWeek, currentWeek - 1] : [currentWeek]
  }
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
