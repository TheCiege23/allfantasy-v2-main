import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { latestProjectionWeek } from './playerProjections'
import { futureWeekProjectionsReady, futureWeekStoreReader } from '@/lib/projections/futureWeekProjectionStore'
import { FUTURE_WEEK_STALE_MS } from '@/lib/projections/futureWeekProjections'
import { FUTURE_WEEK_SOURCE } from '@/lib/projections/futureWeekIngest'

/**
 * Which NFL week a waiver claim made NOW is for — the week a waiver board should price.
 *
 * 🛑 ONCE THE WEEK IS MOSTLY PLAYED, CLAIMS ARE FOR NEXT WEEK, AND UNTIL 2026-10-02 NOTHING COULD
 * PRICE NEXT WEEK. `fantasy_projections` holds one week — the one being played — so on a Monday the
 * boards ranked adds on points already scored, and said so in a banner. Since 2026-09-29 the import
 * also stores Sleeper's board for the weeks AHEAD in `future_week_projections` (measured on
 * production 2026-10-02: weeks 5–8 all published with week 4 current, ~1,000 lines each).
 *
 * The rule:
 * - Price NEXT week once SPENT_SHARE of this week's fixtures have kicked off AND next week's board
 *   is published and its last confirmation is fresher than FUTURE_WEEK_STALE_MS (the import is
 *   daily; an older confirmation means it stopped reaching the week).
 * - Otherwise price the current week — including a mostly-played week whose successor is missing,
 *   which keeps the boards' existing "most of week N has been played" disclosure.
 *
 * ⚠ THE CLOCK LIVES HERE, NOT IN THE BOARDS. The cross-league board is served from a clock-free
 * cache; it takes the week as an argument (summary `period`) and this module is what reads `now`.
 */

/** Share of a week's fixtures kicked off before a claim is for the next week. The board's banner rule. */
export const SPENT_SHARE = 0.75

export type ClaimWeek = {
  season: string
  week: number
  /** 'next' when priced on `future_week_projections`; 'current' when on `fantasy_projections`. */
  basis: 'current' | 'next'
  /** The week `fantasy_projections` holds — the one being played. */
  currentWeek: number
}

/** Pure. `kickoffs` are the current week's (ISO); `nextConfirmedAt` is null when next week is unusable. */
export function chooseClaimWeek(args: {
  current: { season: string; week: number }
  kickoffs: readonly string[] | null
  nextConfirmedAt: Date | null
  nowMs: number
}): ClaimWeek {
  const { current, kickoffs, nextConfirmedAt, nowMs } = args
  const stay: ClaimWeek = { season: current.season, week: current.week, basis: 'current', currentWeek: current.week }
  if (!kickoffs || kickoffs.length === 0) return stay
  const played = kickoffs.filter((iso) => Date.parse(iso) <= nowMs).length
  if (played / kickoffs.length < SPENT_SHARE) return stay
  if (!nextConfirmedAt || nowMs - nextConfirmedAt.getTime() > FUTURE_WEEK_STALE_MS) return stay
  return { season: current.season, week: current.week + 1, basis: 'next', currentWeek: current.week }
}

/** The claim week now. Null only when no projection week is on file at all. Never throws. */
export async function resolveWaiverClaimWeek(nowMs: number = Date.now()): Promise<ClaimWeek | null> {
  const current = await latestProjectionWeek().catch(() => null)
  if (!current) return null
  const [kickoffs, nextConfirmedAt] = await Promise.all([
    projectionWeekKickoffs(current).catch(() => null),
    nextWeekConfirmedAt(current).catch(() => null),
  ])
  return chooseClaimWeek({ current, kickoffs, nextConfirmedAt, nowMs })
}

/** When next week's board was last confirmed published, or null if it is not usable. */
async function nextWeekConfirmedAt(current: { season: string; week: number }): Promise<Date | null> {
  if (!(await futureWeekProjectionsReady())) return null
  const checks = await futureWeekStoreReader.readChecks({
    sport: 'NFL',
    season: current.season,
    source: FUTURE_WEEK_SOURCE,
    afterWeek: current.week,
    throughWeek: current.week + 1,
  })
  const next = checks.find((c) => c.week === current.week + 1)
  if (!next || next.status !== 'published' || next.rowCount <= 0) return null
  return next.confirmedAt ?? next.checkedAt
}

/** One kickoff per distinct fixture of a week (ISO, sorted). Null when the schedule is unread. */
export async function projectionWeekKickoffs(at: { season: string; week: number }): Promise<string[] | null> {
  const season = Number(at.season)
  if (!Number.isFinite(season)) return null
  const games = await prisma.sportsGame
    .findMany({
      where: { sport: 'NFL', season, week: at.week, seasonType: { in: ['regular', 'REG', 'reg', 'Regular', 'regular_season'] } },
      select: { homeTeam: true, awayTeam: true, startTime: true },
    })
    .catch(() => null)
  if (!games || games.length === 0) return null
  /* Each game is stored by more than one source; one fixture per club pair. */
  const kickoffByFixture = new Map<string, Date | null>()
  for (const g of games) {
    const key = [normalizeTeamAbbrev(g.homeTeam) ?? g.homeTeam, normalizeTeamAbbrev(g.awayTeam) ?? g.awayTeam].join('|')
    if (!kickoffByFixture.has(key) || (g.startTime && !kickoffByFixture.get(key))) kickoffByFixture.set(key, g.startTime)
  }
  return [...kickoffByFixture.values()].filter((t): t is Date => t != null).map((t) => t.toISOString()).sort()
}
