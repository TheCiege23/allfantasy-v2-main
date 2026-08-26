import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * "Which week is it?" for anything reading `WeeklyMatchup`.
 *
 * ⚠ NEVER `max(week)`. THIS IS THE MOST DANGEROUS SHAPE IN THIS TABLE.
 *
 * The Sleeper sync bootstraps ALL EIGHTEEN WEEKS as 0-0 rows the first time it
 * runs, before a single game. Measured on production 2026-08-23:
 *
 *     season 2025:   298 rows,   204 scored, weeks to 17
 *     season 2026: 9,354 rows,     0 scored, weeks to 18
 *
 * So `orderBy: [{ seasonYear: 'desc' }, { week: 'desc' }]` resolves to **2026
 * week 18, in August**. That is not an empty state a screen can detect — it is a
 * confident wrong answer. The per-league Matchup screen named the week-18
 * opponent as "this week's"; the cross-league week board found nothing scored in
 * a week nobody has played and read "no scored matchups" all season.
 *
 * The rule that is correct under BOTH shapes: within the latest season on file,
 * the current week is the EARLIEST week still holding an unscored row. When
 * every week is scored the season is over and the last week is the honest
 * answer.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The rule was written once, inline, in `weekBoard.ts`, and three other readers
 * — `matchup.ts`, `weekAll.ts`, `todayStrip.ts` — kept the `max(week)` version.
 * The writer-side fix (`77d4df751`) repaired the two modules that WRITE this
 * table and touched none of the four that read it, so the frontier bug was
 * fixed at the source while every reader still asked the wrong question.
 *
 * Any new reader of `WeeklyMatchup` uses this. A fifth private copy of the rule
 * is how three of them drifted in the first place.
 */

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

/**
 * Resolve straight from the database for a set of leagues.
 *
 * ⚠ `leagueId` HERE IS `League.platformLeagueId`, NOT `League.id`. WeeklyMatchup
 * is written from the provider payload and lives in the other of this repo's two
 * league-id spaces. Joining on `League.id` matches zero rows and returns an
 * empty set with no error — a silent wrong answer, not a failure.
 *
 * Two queries rather than one: the latest season, then that season's weeks
 * grouped with their point totals. Grouping avoids pulling ~9,000 rows to answer
 * a question about at most eighteen weeks.
 */
export async function resolveCurrentWeekForLeagues(
  platformLeagueIds: string[],
): Promise<ResolvedWeek | null> {
  if (platformLeagueIds.length === 0) return null

  const newest = await prisma.weeklyMatchup
    .findFirst({
      where: { leagueId: { in: platformLeagueIds } },
      orderBy: { seasonYear: 'desc' },
      select: { seasonYear: true },
    })
    .catch(() => null)

  if (!newest) return null

  const byWeek = await prisma.weeklyMatchup
    .groupBy({
      by: ['week'],
      where: { leagueId: { in: platformLeagueIds }, seasonYear: newest.seasonYear },
      _sum: { pointsFor: true, pointsAgainst: true },
    })
    .catch(() => [] as Array<{ week: number; _sum: { pointsFor: number | null; pointsAgainst: number | null } }>)

  if (byWeek.length === 0) return null

  let firstUnplayed: number | null = null
  let lastWeek = 0
  let scoredWeeks = 0

  for (const g of byWeek) {
    lastWeek = Math.max(lastWeek, g.week)
    const total = (g._sum.pointsFor ?? 0) + (g._sum.pointsAgainst ?? 0)
    if (total > 0) {
      scoredWeeks += 1
      continue
    }
    if (firstUnplayed == null || g.week < firstUnplayed) firstUnplayed = g.week
  }

  return {
    season: newest.seasonYear,
    week: firstUnplayed ?? lastWeek,
    seasonComplete: firstUnplayed == null,
    scoredWeeks,
  }
}

/** Single-league convenience. Same rule, same id space caveat. */
export async function resolveCurrentWeekForLeague(
  platformLeagueId: string,
): Promise<ResolvedWeek | null> {
  return resolveCurrentWeekForLeagues([platformLeagueId])
}
