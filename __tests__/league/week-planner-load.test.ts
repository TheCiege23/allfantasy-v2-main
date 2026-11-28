/**
 * The games-this-week planner's DB read (lib/league/weekPlannerLoad.ts), on the real paths:
 *
 *   NHL     -> the real `readWeekGames` over SportsGame rows (two feeds, one stale): freshest wins
 *   MLB     -> the real `readRiScheduleWindow` over the committed capture
 *              contracts/rolling-insights/fixtures/schedule-season.MLB.json, run through the real
 *              `parseRiScheduleSeason` and stored the way the sync stores it (one cache row per day)
 *   NCAAB   -> the same, from schedule-season.NCAABB.json — a 2025-26 capture, shifted +364 days
 *              (whole weeks, so every weekday is kept) because only the 2026-27 opener is recorded
 *
 * Only the database is faked. The week window is the league's (dailySportSeasonStarts.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cache = vi.hoisted(() => ({ rows: new Map<string, unknown>(), games: [] as unknown[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => (cache.rows.has(where.cacheKey) ? { data: cache.rows.get(where.cacheKey) } : null)),
      findMany: vi.fn(async ({ where }: { where: { cacheKey: { in: string[] } } }) =>
        where.cacheKey.in.filter((k) => cache.rows.has(k)).map((k) => ({ cacheKey: k, data: cache.rows.get(k) })),
      ),
    },
    sportsGame: { findMany: vi.fn(async () => cache.games) },
  },
}))

import { loadWeekPlanner } from '@/lib/league/weekPlannerLoad'
import { parseRiScheduleSeason } from '@/lib/sports-data/riSeasonSchedule'
import { scheduleKeyPrefix, type ScheduleGame } from '@/lib/sports-data/riScheduleCache'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { plannerTeamCode } from '@/lib/league/weekPlanner'

const DAY = 86_400_000

function fixtureGames(file: string, shiftDays = 0): ScheduleGame[] {
  const json = JSON.parse(readFileSync(join(process.cwd(), 'contracts/rolling-insights/fixtures', file), 'utf8')) as { data: Record<string, unknown[]> }
  const games = parseRiScheduleSeason(Object.values(json.data)[0])
  if (!shiftDays) return games
  return games.map((g) => ({
    ...g,
    day: new Date(Date.parse(`${g.day}T00:00:00Z`) + shiftDays * DAY).toISOString().slice(0, 10),
    startTime: g.startTime ? new Date(Date.parse(g.startTime) + shiftDays * DAY).toISOString() : null,
  }))
}

/** Store a season as the sync does: a meta row and one row per Eastern day. */
function storeSchedule(sport: string, season: number, games: ScheduleGame[]) {
  const prefix = scheduleKeyPrefix(sport, season)
  cache.rows.set(`${prefix}meta`, { games: games.length })
  const byDay = new Map<string, ScheduleGame[]>()
  for (const g of games) byDay.set(g.day, [...(byDay.get(g.day) ?? []), g])
  for (const [d, list] of byDay) cache.rows.set(`${prefix}${d}`, { games: list })
}

/** What the fixture says the league's week holds, counted independently of the planner. */
function expectedWeek(games: ScheduleGame[], sport: string, season: number, now: Date) {
  const week = dailySportWeekForInstant(sport, season, now)!
  const w = resolveDailySportWeekWindow(sport, season, week)!
  const inWeek = games.filter((g) => {
    const t = Date.parse(`${g.day}T00:00:00Z`)
    return t >= w.start.getTime() && t < w.end.getTime() && (g.seasonType == null || g.seasonType === 'regular') &&
      !g.replacedBy && !['replaced', 'postponed', 'cancelled'].includes(String(g.status ?? '').toLowerCase())
  })
  return { week, inWeek }
}

beforeEach(() => {
  cache.rows.clear()
  cache.games = []
})

describe.each([
  { sport: 'MLB', file: 'schedule-season.MLB.json', season: 2026, shift: 0, now: '2026-06-10T16:00:00Z' },
  { sport: 'NCAAB', file: 'schedule-season.NCAABB.json', season: 2026, shift: 364, now: '2026-12-09T16:00:00Z' },
])('$sport — the Rolling Insights season schedule', ({ sport, file, season, shift, now }) => {
  it('plans the league week from the stored schedule, every game once, both teams', async () => {
    const games = fixtureGames(file, shift)
    storeSchedule(sport, season, games)
    const at = new Date(now)
    const { week, inWeek } = expectedWeek(games, sport, season, at)
    expect(inWeek.length).toBeGreaterThan(10) // control: the fixture really has this week

    const p = (await loadWeekPlanner({ sport, season, now: at }))!
    expect(p).not.toBeNull()
    expect(p.week).toBe(week)
    expect(p.days).toHaveLength(7)
    expect(p.days.reduce((s, d) => s + d.games, 0)).toBe(inWeek.length)
    // Every team appearance is one game: total team-games is twice the slate.
    expect(p.teams.reduce((s, t) => s + t.count, 0)).toBe(inWeek.length * 2)
    // A real team from the fixture, under its planner code, with its real opponents.
    const g = inWeek[0]
    const home = p.teams.find((t) => t.team === plannerTeamCode(sport, g.homeTeam))!
    expect(home.games.some((x) => x.day === g.day && x.home)).toBe(true)
  })

  it('next week is the following seven days', async () => {
    const games = fixtureGames(file, shift)
    storeSchedule(sport, season, games)
    const at = new Date(now)
    const p0 = (await loadWeekPlanner({ sport, season, now: at }))!
    const p1 = (await loadWeekPlanner({ sport, season, now: at, offset: 1 }))!
    expect(p1.week).toBe(p0.week + 1)
    expect(Date.parse(`${p1.days[0].day}T00:00:00Z`) - Date.parse(`${p0.days[0].day}T00:00:00Z`)).toBe(7 * DAY)
  })

  it('leaves out a preseason game, a postponed one, and one replaced by a makeup', async () => {
    const games = fixtureGames(file, shift)
    const at = new Date(now)
    const { inWeek } = expectedWeek(games, sport, season, at)
    // Home and away swapped: a fixture the de-duplication would NOT fold into the real game, so only
    // the status filter can keep it out. (A copy with the same teams is dropped by de-dup first, and a
    // test built on that passes with the filter deleted — measured.)
    const real = inWeek[0]
    const g: ScheduleGame = { ...real, homeTeam: real.awayTeam, awayTeam: real.homeTeam, homeTeamId: real.awayTeamId, awayTeamId: real.homeTeamId }
    const extra: ScheduleGame[] = [
      { ...g, gameId: `${g.gameId}-pre`, seasonType: 'pre' },
      { ...g, gameId: `${g.gameId}-ppd`, status: 'postponed' },
      { ...g, gameId: `${g.gameId}-old`, replacedBy: 'makeup-1' },
    ]
    storeSchedule(sport, season, [...games, ...extra])
    const p = (await loadWeekPlanner({ sport, season, now: at }))!
    expect(p.days.reduce((s, d) => s + d.games, 0)).toBe(inWeek.length)
  })

  it('an unsynced schedule is no planner, never a partial one', async () => {
    expect(await loadWeekPlanner({ sport, season, now: new Date(now) })).toBeNull()
  })
})

describe('NHL — ranked SportsGame feeds through readWeekGames', () => {
  it('takes the freshest feed, counts a game once, and keeps Eastern days', async () => {
    const now = new Date('2026-11-25T17:00:00Z')
    const fresh = new Date(now.getTime() - 60_000)
    const stale = new Date(now.getTime() - 12 * 3600_000)
    // 7pm Eastern Wednesday = Thursday 00:00 UTC: it belongs to Wednesday.
    const wed7pm = new Date('2026-11-26T00:00:00Z')
    const row = (source: string, fetchedAt: Date, home: string, away: string, startTime: Date) => ({
      homeTeam: home, awayTeam: away, startTime, status: 'scheduled', source, fetchedAt, season: 2026, week: 9, seasonType: 'regular',
    })
    cache.games = [
      row('espn', fresh, 'TOR', 'BOS', wed7pm),
      row('espn', fresh, 'EDM', 'CGY', new Date('2026-11-27T01:00:00Z')),
      row('thesportsdb', stale, 'Toronto Maple Leafs', 'Boston Bruins', wed7pm),
    ]
    const p = (await loadWeekPlanner({ sport: 'NHL', season: 2026, now }))!
    expect(p).not.toBeNull()
    const tor = p.teams.find((t) => t.team === plannerTeamCode('NHL', 'TOR'))!
    expect(tor.count).toBe(1)
    expect(tor.games[0]).toMatchObject({ day: '2026-11-25', home: true })
    const wed = p.days.find((d) => d.day === '2026-11-25')!
    expect(wed.games).toBe(1)
  })
})
