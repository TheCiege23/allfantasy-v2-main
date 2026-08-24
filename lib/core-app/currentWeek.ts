import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Which week of `WeeklyMatchup` is "this week".
 *
 * ⚠ IT IS THE EARLIEST UNPLAYED WEEK, NEVER `max(week)`. The obvious reading —
 * latest season, latest week on file — is correct only while every row on file
 * is a COMPLETED week, which was true for as long as the table held nothing
 * but finished 2025 rows.
 *
 * It stopped being true the moment a season was ingested ahead of itself. The
 * Sleeper sync bootstraps ALL 18 weeks of a league's schedule as 0-0 rows the
 * first time it runs, before a single snap. Measured on production 2026-08-23:
 *
 *     season 2025: 298 rows, 204 scored, weeks to 17
 *     season 2026: 9,354 rows, **0 scored**, weeks to 18
 *
 * Under `max(week)` that resolves to 2026 week 18 in August — so the matchup
 * screen names your week-18 opponent as this week's, the cross-league week
 * reads an unplayed week 18 and finds nothing scored, and win probability
 * never prices because the scored set is empty. Nothing errors; the product is
 * just confidently wrong about which week it is.
 *
 * The rule that holds under both shapes: inside the latest season on file, the
 * current week is the earliest week that still carries an unscored row. When
 * every week is scored the season is over and the last week is the honest
 * answer. This is the same rule weekBoard.ts already applies in memory —
 * extracted here so the three readers that still took the maximum share it
 * rather than each growing their own copy.
 *
 * Two indexed round-trips (three only in the finished-season case), which is
 * what the callers already spent on their single `findFirst`.
 */

export type CurrentWeek = { seasonYear: number; week: number }

/** A row counts as played once either side has put up a point. */
const UNPLAYED = { pointsFor: { lte: 0 }, pointsAgainst: { lte: 0 } } as const

export async function resolveCurrentWeek(
  platformLeagueIds: string[],
): Promise<CurrentWeek | null> {
  const ids = platformLeagueIds.filter((v) => typeof v === 'string' && v.length > 0)
  if (ids.length === 0) return null

  const newest = await prisma.weeklyMatchup
    .findFirst({
      where: { leagueId: { in: ids } },
      orderBy: { seasonYear: 'desc' },
      select: { seasonYear: true },
    })
    .catch(() => null)
  if (!newest) return null
  const seasonYear = newest.seasonYear

  const unplayed = await prisma.weeklyMatchup
    .findFirst({
      where: { leagueId: { in: ids }, seasonYear, ...UNPLAYED },
      orderBy: { week: 'asc' },
      select: { week: true },
    })
    .catch(() => null)
  if (unplayed) return { seasonYear, week: unplayed.week }

  /* Every week scored: the season is complete, so its last week is current. */
  const last = await prisma.weeklyMatchup
    .findFirst({
      where: { leagueId: { in: ids }, seasonYear },
      orderBy: { week: 'desc' },
      select: { week: true },
    })
    .catch(() => null)
  return last ? { seasonYear, week: last.week } : null
}

/**
 * Single-league form. `weekParam` pins an explicitly requested week — the user
 * asked for it, so no inference is applied beyond confirming rows exist.
 */
export async function resolveCurrentWeekForLeague(
  platformLeagueId: string,
  weekParam?: number | null,
): Promise<CurrentWeek | null> {
  if (weekParam != null) {
    const pinned = await prisma.weeklyMatchup
      .findFirst({
        where: { leagueId: platformLeagueId, week: weekParam },
        orderBy: { seasonYear: 'desc' },
        select: { seasonYear: true, week: true },
      })
      .catch(() => null)
    return pinned ? { seasonYear: pinned.seasonYear, week: pinned.week } : null
  }
  return resolveCurrentWeek([platformLeagueId])
}
