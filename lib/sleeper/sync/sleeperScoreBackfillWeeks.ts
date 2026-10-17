import { prisma } from '@/lib/prisma'

/**
 * Finished weeks whose per-player scores were never ingested — the backfill half of the Sleeper sync.
 *
 * `sleeperScoreTargetWeeks` fetches only the live week and the one before it, which is right for live
 * scoring and stat corrections and leaves every earlier week of the season empty. Lineup efficiency on
 * the standings page is a season figure, so it needs those weeks too. This picks them, a few per sync.
 *
 * ⚠ BOUNDED PER RUN ON PURPOSE. A league connected mid-season has a dozen weeks missing; fetching them
 * all in one sync is a dozen extra Sleeper requests inside a run that also has a budget. A few per run
 * clears the backlog over a few syncs, and once it is clear the steady state costs nothing: a week is
 * only picked while it has NO score rows at all.
 *
 * ⚠ "FINISHED" MEANS SCORED AND OLDER THAN THE TARGET WEEKS. Weeks the target rule already covers are
 * skipped so one sync never fetches a week twice; a week with no points on its matchups has not been
 * played, and Sleeper's placeholder rows would write nothing anyway.
 */

/** How many missing weeks one sync run may fetch. */
export const BACKFILL_WEEKS_PER_RUN = 4

/**
 * PURE: the weeks to fetch, oldest first.
 *
 * `scoredWeeks` — weeks whose matchups carry points. `haveWeeks` — weeks that already have score rows.
 * `targetWeeks` — weeks the live rule fetches this run anyway.
 */
export function pickBackfillWeeks(args: {
  scoredWeeks: readonly number[]
  haveWeeks: readonly number[]
  targetWeeks: readonly number[]
  limit?: number
}): number[] {
  const have = new Set(args.haveWeeks)
  const targets = new Set(args.targetWeeks)
  const oldestTarget = args.targetWeeks.length > 0 ? Math.min(...args.targetWeeks) : Infinity
  return [...new Set(args.scoredWeeks)]
    .filter((w) => Number.isInteger(w) && w >= 1 && w < oldestTarget && !targets.has(w) && !have.has(w))
    .sort((a, b) => a - b)
    .slice(0, Math.max(0, args.limit ?? BACKFILL_WEEKS_PER_RUN))
}

/** The same, read from the database for one Sleeper league-season. */
export async function sleeperScoreBackfillWeeks(
  externalLeagueId: string,
  season: number,
  targetWeeks: readonly number[],
): Promise<number[]> {
  const [matchupWeeks, scoreWeeks] = await Promise.all([
    prisma.weeklyMatchup.groupBy({
      by: ['week'],
      where: { leagueId: externalLeagueId, seasonYear: season },
      _sum: { pointsFor: true },
    }),
    prisma.leaguePlayerWeeklyScore.groupBy({
      by: ['week'],
      where: { leagueId: externalLeagueId, seasonYear: season },
    }),
  ])
  return pickBackfillWeeks({
    scoredWeeks: matchupWeeks.filter((r) => (r._sum.pointsFor ?? 0) > 0).map((r) => r.week),
    haveWeeks: scoreWeeks.map((r) => r.week),
    targetWeeks,
  })
}
