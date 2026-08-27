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

/* ─────────────────────────────────────────────────────────────────────────
 * Pure, in-memory variants.
 *
 * The two functions above answer the same question from the database. These
 * answer it from rows a caller has ALREADY fetched, which is what the
 * standings surfaces need: they read the season anyway, and deriving the week
 * from exactly the rows being rendered means the two can never disagree.
 *
 * `scoredWeeks` is the load-bearing one. A freshly synced league carries a
 * whole season of 0-0 rows, so "how many weeks have actually been played" is
 * the difference between a real table and twelve teams tied on zero in
 * arbitrary order. leagueStandings.ts and publicStandings.ts both refuse to
 * render when it is 0.
 * ───────────────────────────────────────────────────────────────────────── */

/** The shape any caller can supply — a subset of a `WeeklyMatchup` row. */
export type WeekScoreRow = {
  seasonYear: number
  week: number
  pointsFor: number
  pointsAgainst: number
}

export type ResolvedWeek = {
  season: number
  week: number
  /**
   * True when every week in the season carries a score — the regular season is
   * done and `week` is the last one played rather than the next one to play.
   */
  seasonComplete: boolean
  /** Weeks in this season with at least one scored row. Zero means nothing has
   *  been played yet, which is the case a ranking must refuse to rank. */
  scoredWeeks: number
}

/** A row counts as played once either side has put up a point. */
export function isScored(r: { pointsFor: number; pointsAgainst: number }): boolean {
  return r.pointsFor > 0 || r.pointsAgainst > 0
}

/**
 * Resolve from rows already in memory.
 *
 * Preferred when the caller has fetched the season anyway — it costs nothing
 * extra and keeps the "which week" answer derived from exactly the rows being
 * rendered, so the two can never disagree.
 */
export function resolveCurrentWeekFrom(rows: WeekScoreRow[]): ResolvedWeek | null {
  if (rows.length === 0) return null

  let season = 0
  for (const r of rows) season = Math.max(season, r.seasonYear)

  const seasonRows = rows.filter((r) => r.seasonYear === season)
  if (seasonRows.length === 0) return null

  let firstUnplayed: number | null = null
  let lastWeek = 0
  const scored = new Set<number>()

  for (const r of seasonRows) {
    lastWeek = Math.max(lastWeek, r.week)
    if (isScored(r)) {
      scored.add(r.week)
      continue
    }
    if (firstUnplayed == null || r.week < firstUnplayed) firstUnplayed = r.week
  }

  return {
    season,
    week: firstUnplayed ?? lastWeek,
    seasonComplete: firstUnplayed == null,
    scoredWeeks: scored.size,
  }
}
