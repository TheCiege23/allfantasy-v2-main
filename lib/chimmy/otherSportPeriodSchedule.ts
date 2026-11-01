import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readRiScheduleWindow } from '@/lib/sports-data/riScheduleCache'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { readWeekGames, RI_SCHEDULE_SLATE_SPORTS } from '@/lib/redraft/weekGames'
import { normalizeLockTeam } from '@/lib/redraft/lineupLock'
import { windowStart } from './actions/gameLocks'
import { LIVE_SCORE_SOURCES } from '@/lib/scores/liveSourceSelection'

export type RemainingGames = { count: number; opponents: string[]; verified: boolean }
export type PeriodSchedule = { label: string; source: string; byTeam: Map<string, RemainingGames> }

/** Count only games still to start in the league's current scoring window. */
export async function loadOtherSportPeriodSchedule(args: {
  sport: string; season: number; week: number; teams: string[]; now?: Date
}): Promise<PeriodSchedule | null> {
  const now = args.now ?? new Date()
  const sport = args.sport.toUpperCase()
  const window = sport === 'NCAAF'
    ? { start: windowStart(sport, now), end: new Date(windowStart(sport, now).getTime() + 7 * 86_400_000) }
    : resolveDailySportWeekWindow(sport, args.season, args.week)
  if (!window || now.getTime() >= window.end.getTime() || now.getTime() < window.start.getTime() - 3 * 86_400_000) return null

  type Fixture = { home: string | null; away: string | null; start: Date | null; day: string | null }
  let fixtures: Fixture[]
  let source: string
  if (RI_SCHEDULE_SLATE_SPORTS.includes(sport)) {
    const rows = await readRiScheduleWindow(prisma as never, { sport, season: args.season, window }).catch(() => null)
    if (!rows) return null
    fixtures = rows.filter((r) => (r.seasonType == null || r.seasonType === 'regular') &&
      !r.replacedBy && !['replaced', 'postponed', 'cancelled'].includes(String(r.status ?? '').toLowerCase()))
      .map((r) => ({ home: r.homeTeam ?? null, away: r.awayTeam ?? null,
        start: r.startTime && Number.isFinite(Date.parse(r.startTime)) ? new Date(r.startTime) : null, day: r.day }))
    source = 'Rolling Insights season schedule'
  } else if (sport === 'NCAAF') {
    const rows = await prisma.sportsGame.findMany({
      where: { sport: { in: ['NCAAF', 'NCAAFB'] }, season: args.season,
        startTime: { gte: window.start, lt: window.end }, source: { in: [...LIVE_SCORE_SOURCES] },
        OR: [{ seasonType: 'regular' }, { seasonType: null }] },
      select: { homeTeam: true, awayTeam: true, startTime: true },
    }).catch(() => [])
    const unique = new Map<string, Fixture>()
    for (const r of rows) {
      const home = normalizeLockTeam(sport, r.homeTeam)
      const away = normalizeLockTeam(sport, r.awayTeam)
      if (!home || !away || !r.startTime) continue
      unique.set(`${home}:${away}:${r.startTime.toISOString().slice(0, 10)}`,
        { home: r.homeTeam, away: r.awayTeam, start: r.startTime, day: null })
    }
    fixtures = [...unique.values()]
    source = 'ranked college football schedule'
  } else {
    const rows = await readWeekGames(prisma, { sport, season: args.season, week: args.week,
      seasonType: 'regular', dateWindow: window, now }).catch(() => [])
    fixtures = rows.map((r) => ({ home: r.homeTeam, away: r.awayTeam, start: r.startTime, day: null }))
    source = 'ranked league sport schedule'
  }
  if (fixtures.length === 0) return null
  const today = easternCalendarDay(now)?.toISOString().slice(0, 10) ?? now.toISOString().slice(0, 10)
  const byTeam = new Map<string, RemainingGames>()
  for (const team of args.teams) {
    const key = normalizeLockTeam(sport, team)
    const related = fixtures.filter((g) => key && [g.home, g.away].some((t) => normalizeLockTeam(sport, t) === key))
    const remaining = related.filter((g) => g.start ? g.start > now : Boolean(g.day && g.day > today))
    const unknownToday = related.some((g) => !g.start && g.day === today)
    byTeam.set(team, { count: remaining.length,
      opponents: remaining.map((g) => normalizeLockTeam(sport, g.home) === key ? g.away : g.home)
        .filter((v): v is string => Boolean(v)).slice(0, 8),
      verified: related.length > 0 && !unknownToday && related.every((g) => Boolean(g.home && g.away)) })
  }
  return { label: `season ${args.season}, scoring week ${args.week}`, source, byTeam }
}
