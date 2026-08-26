import type { PrismaClient } from '@prisma/client'

import { findMyRoster, rosterPlayerIds } from '@/lib/core-app/myRoster'

import { loadActualWeeklyPoints, type ActualWeekOutcome } from './actualWeeklyPoints'

/**
 * Every player on the caller's roster, with what he actually scored in a week.
 *
 * Serves the team surfaces the way the matchup loader serves the scoreboard. It resolves the
 * roster SERVER-SIDE from the claimed team rather than accepting a list of ids from the client:
 * a caller that can name arbitrary player ids can ask what anybody scored, and the answer here
 * is scoped to a league the caller is already authorised for.
 *
 * ⚠ THE WEEK IS RESOLVED FROM THE DATA, NOT THE CLOCK. The ingest runs on its own schedule and
 * stalls entirely over the offseason, so "current week" by calendar returns `no_game` for
 * everybody and reads as broken.
 */

export interface RosterWeekPayload {
  season: number | null
  week: number | null
  /** Keyed by Sleeper id. Absent players were not on the roster. */
  points: Record<string, ActualWeekOutcome>
  /** False when the league states no scoring, in which case nothing here is priced. */
  scored: boolean
  reason: string | null
}

const EMPTY = (reason: string): RosterWeekPayload => ({
  season: null,
  week: null,
  points: {},
  scored: false,
  reason,
})

export async function loadRosterWeekPoints(args: {
  prisma: PrismaClient
  leagueId: string
  userId: string
  season?: number
  week?: number
}): Promise<RosterWeekPayload> {
  const league =
    (await args.prisma.league
      .findUnique({ where: { id: args.leagueId }, select: { id: true, settings: true } })
      .catch(() => null)) ??
    (await args.prisma.league
      .findFirst({
        where: { platformLeagueId: args.leagueId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, settings: true },
      })
      .catch(() => null))
  if (!league) return EMPTY('league not found')

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const scoring = (settings.scoring_settings ?? settings.scoringSettings ?? null) as
    | Record<string, unknown>
    | null
  if (!scoring) return EMPTY('this league states no scoring settings, so nothing can be priced')

  const mine = await findMyRoster(args.prisma, league.id, args.userId)
  if (!mine.found) {
    return EMPTY(
      mine.reason === 'no_team_claimed'
        ? 'we cannot tell which team in this league is yours'
        : 'no roster rows imported for your team',
    )
  }
  const ids = rosterPlayerIds(mine.playerData)
  if (ids.length === 0) return EMPTY('your roster has no players on file')

  let season = args.season ?? null
  let week = args.week ?? null
  if (season == null || week == null) {
    const newest = await args.prisma.playerGameStat
      .aggregate({ where: { sportType: 'NFL' }, _max: { season: true } })
      .catch(() => null)
    season = newest?._max.season ?? null
    if (season == null) return EMPTY('no scored games on file yet')
    const nw = await args.prisma.playerGameStat
      .aggregate({ where: { sportType: 'NFL', season }, _max: { weekOrRound: true } })
      .catch(() => null)
    week = nw?._max.weekOrRound ?? null
    if (week == null) return EMPTY('no scored games on file yet')
  }

  const map = await loadActualWeeklyPoints({
    prisma: args.prisma,
    season,
    week,
    playerIds: ids,
    scoring,
  })

  return { season, week, points: Object.fromEntries(map), scored: true, reason: null }
}
