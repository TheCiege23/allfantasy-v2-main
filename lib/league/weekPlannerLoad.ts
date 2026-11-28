import 'server-only'

import { prisma } from '@/lib/prisma'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { readWeekGames, RI_SCHEDULE_SLATE_SPORTS } from '@/lib/redraft/weekGames'
import { buildWeekPlanner, type PlannerFixture, type WeekPlanner } from './weekPlanner'

/**
 * The league's scoring week of games, from Postgres only (no provider call on a request path).
 *
 * The slate comes from the reads the lineup lock and the week finalizer already trust:
 *   NHL / NBA                 `readWeekGames` — ranked SportsGame feeds, freshest wins, Eastern days
 *   NCAAB / SOCCER / MLB      the Rolling Insights season schedule (`readRiScheduleWindow`), because
 *                             SportsGame is INCOMPLETE for them (lib/redraft/weekGames.ts)
 * which is the same split `lib/chimmy/otherSportPeriodSchedule.ts` makes. An unsynced schedule is no
 * planner, never a partial one: a team missing a game would read as a worse streaming pick.
 *
 * `offset` 0 is the week the calendar is in; 1 is next week (planning a Sunday-night add).
 */

export const PLANNER_SPORTS: readonly string[] = ['NHL', 'NBA', 'NCAAB', 'MLB', 'SOCCER']

export async function loadWeekPlanner(args: {
  sport: string
  season: number
  offset?: number
  now?: Date
}): Promise<WeekPlanner | null> {
  const sport = args.sport.toUpperCase()
  if (!PLANNER_SPORTS.includes(sport)) return null
  const now = args.now ?? new Date()
  const current = dailySportWeekForInstant(sport, args.season, now)
  if (current == null) return null
  const week = current + Math.max(0, Math.min(1, Math.trunc(args.offset ?? 0)))
  const window = resolveDailySportWeekWindow(sport, args.season, week)
  if (!window) return null

  let fixtures: PlannerFixture[]
  if (RI_SCHEDULE_SLATE_SPORTS.includes(sport)) {
    const rows = await readRiScheduleWindow(prisma as never, { sport, season: args.season, window })
    if (!rows) return null
    fixtures = rows
      .filter(
        (r) =>
          (r.seasonType == null || r.seasonType === 'regular') &&
          !r.replacedBy &&
          !['replaced', 'postponed', 'cancelled'].includes(String(r.status ?? '').toLowerCase()),
      )
      .map((r) => ({
        home: sport === 'SOCCER' ? r.homeTeamId ?? null : r.homeTeam ?? null,
        away: sport === 'SOCCER' ? r.awayTeamId ?? null : r.awayTeam ?? null,
        homeLabel: r.homeTeam ?? null,
        awayLabel: r.awayTeam ?? null,
        start: r.startTime && Number.isFinite(Date.parse(r.startTime)) ? new Date(r.startTime) : null,
        day: r.day ?? null,
      }))
  } else {
    const rows = await readWeekGames(prisma, { sport, season: args.season, week, seasonType: 'regular', dateWindow: window, now })
    fixtures = rows
      .filter((r) => !/postpon|cancel|suspend|replaced|abandon/i.test(String(r.status ?? '')))
      .map((r) => ({ home: r.homeTeam, away: r.awayTeam, start: r.startTime }))
  }

  return buildWeekPlanner({ sport, week, window, fixtures, now })
}
