/** @vitest-environment node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Soccer's slate and weeks. One pool spans EPL, La Liga and Serie A, and SportsGame holds only the
 * EPL, so the finalizer reads the Rolling Insights season schedule for all three — captured with
 * probe.sh into fixtures/schedule-season.SOCCER.<LEAGUE>.json (2026-27, 1,179 rows). And soccer stops
 * for international breaks, so its weeks are GAMEWEEKS: only the Friday-to-Thursday windows that hold
 * a game, or an empty week could never seal.
 */

const h = vi.hoisted(() => ({ riFetchRows: vi.fn() }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({
  riFetchRows: (...a: unknown[]) => h.riFetchRows(...a),
}))

import { parseRiScheduleSeason, syncRiSeasonSchedule } from '@/lib/sports-data/riSeasonSchedule'
import { readWeekSlate } from '@/lib/redraft/weekFinalizer'
import { DATE_WINDOWED_SPORTS, RI_SCHEDULE_SLATE_SPORTS } from '@/lib/redraft/weekGames'
import {
  dailySportWeekForInstant,
  resolveDailySportSeasonStart,
  resolveDailySportWeekWindow,
} from '@/lib/season-week/dailySportSeasonStarts'
import { relabelDailySportWeeks } from '@/lib/season-week/sportWeekSignal'

const LEAGUES = ['EPL', 'LALIGA', 'SERIEA'] as const
const fixture = (league: string) =>
  (JSON.parse(readFileSync(path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', `schedule-season.SOCCER.${league}.json`), 'utf8')) as {
    data: Record<string, unknown[]>
  }).data[league]
const ROWS = Object.fromEntries(LEAGUES.map((l) => [l, fixture(l)])) as Record<(typeof LEAGUES)[number], unknown[]>

function memoryCache() {
  const store = new Map<string, unknown>()
  const db = {
    sportsDataCache: {
      upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown } }) => {
        store.set(where.cacheKey, create.data)
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async ({ where }: { where: { cacheKey: { in: string[] } } }) =>
        where.cacheKey.in.filter((k) => store.has(k)).map((k) => ({ cacheKey: k, data: store.get(k) })),
      ),
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) =>
        store.has(where.cacheKey) ? { data: store.get(where.cacheKey) } : null,
      ),
    },
  }
  return { store, db }
}
const ok = (r: unknown[]) => ({ rows: r, notModified: false, unsupported: false, error: null })
const byLeague = (overrides: Partial<Record<string, unknown>> = {}) =>
  h.riFetchRows.mockImplementation(async (_e: string, req: { league?: string }) =>
    (overrides[req.league ?? ''] as never) ?? ok(ROWS[req.league as (typeof LEAGUES)[number]] ?? []),
  )

beforeEach(() => vi.clearAllMocks())

describe('the captured schedules', () => {
  it('parse whole: every row, dated by the Eastern day in its id', () => {
    for (const l of LEAGUES) expect(parseRiScheduleSeason(ROWS[l])).toHaveLength(ROWS[l].length)
    expect(LEAGUES.map((l) => ROWS[l].length)).toEqual([398, 397, 384])
  })

  it('soccer is date-windowed and reads the RI schedule slate', () => {
    expect(DATE_WINDOWED_SPORTS).toContain('SOCCER')
    expect(RI_SCHEDULE_SLATE_SPORTS).toContain('SOCCER')
  })
})

describe('syncRiSeasonSchedule — SOCCER is three schedules, all or nothing', () => {
  it('fetches each league and stores their games merged by day', async () => {
    byLeague()
    const { store, db } = memoryCache()
    const r = await syncRiSeasonSchedule({ sport: 'SOCCER', season: 2026, db: db as never })
    expect(h.riFetchRows.mock.calls.map((c) => (c[1] as { league?: string }).league)).toEqual(['EPL', 'LALIGA', 'SERIEA'])
    expect(r.games).toBe(398 + 397 + 384)
    // 22 Aug 2026: EPL, La Liga and Serie A all played.
    const day = store.get('SOCCER:rischedule:2026:2026-08-22') as { games: Array<{ gameId: string }> }
    const ids = new Set(day.games.map((g) => g.gameId))
    for (const l of LEAGUES) {
      const expected = parseRiScheduleSeason(ROWS[l]).filter((g) => g.day === '2026-08-22')
      expect(expected.length).toBeGreaterThan(0)
      for (const g of expected) expect(ids.has(g.gameId)).toBe(true)
    }
  })

  it('writes NOTHING when one league answers 304 — two of three would seal weeks missing a league', async () => {
    byLeague({ LALIGA: { rows: [], notModified: true, unsupported: false, error: null } })
    const { store, db } = memoryCache()
    const r = await syncRiSeasonSchedule({ sport: 'SOCCER', season: 2026, db: db as never })
    expect(r.notModified).toBe(true)
    expect(store.size).toBe(0)
    expect(db.sportsDataCache.upsert).not.toHaveBeenCalled()
  })

  it('writes NOTHING when one league returns a 200 with no games', async () => {
    byLeague({ SERIEA: ok([]) })
    const { store, db } = memoryCache()
    const r = await syncRiSeasonSchedule({ sport: 'SOCCER', season: 2026, db: db as never })
    expect(r.error).toMatch(/SERIEA/)
    expect(store.size).toBe(0)
  })

  it('[control] NCAAB still makes one call, with no league', async () => {
    h.riFetchRows.mockResolvedValue(ok([]))
    await syncRiSeasonSchedule({ sport: 'NCAAB', season: 2026, db: memoryCache().db as never })
    expect(h.riFetchRows).toHaveBeenCalledTimes(1)
    expect((h.riFetchRows.mock.calls[0]![1] as { league?: string }).league).toBeUndefined()
  })
})

describe('gameweeks', () => {
  const liveGames = LEAGUES.flatMap((l) => parseRiScheduleSeason(ROWS[l])).filter((g) => g.status !== 'replaced')

  it('are 38 windows, the last starting 28 May 2027', () => {
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 1)?.start.toISOString()).toBe('2026-08-14T00:00:00.000Z')
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 38)?.start.toISOString()).toBe('2027-05-28T00:00:00.000Z')
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 39)).toBeNull()
    expect(resolveDailySportSeasonStart('SOCCER', 2026)).toBe('2026-08-14T00:00:00.000Z')
  })

  it('skip the international break: gameweek 6 is 18 Sep, gameweek 7 is 9 Oct', () => {
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 6)?.start.toISOString().slice(0, 10)).toBe('2026-09-18')
    expect(resolveDailySportWeekWindow('SOCCER', 2026, 7)?.start.toISOString().slice(0, 10)).toBe('2026-10-09')
    expect(dailySportWeekForInstant('SOCCER', 2026, new Date('2026-10-01T12:00:00Z'))).toBeNull()
  })

  it('every scheduled game falls in exactly one gameweek, and every gameweek holds a game', () => {
    const counts = new Map<number, number>()
    const orphans: string[] = []
    for (const g of liveGames) {
      const week = dailySportWeekForInstant('SOCCER', 2026, new Date(`${g.day}T12:00:00Z`))
      if (week == null) orphans.push(g.gameId)
      else counts.set(week, (counts.get(week) ?? 0) + 1)
    }
    expect(orphans).toEqual([])
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 38 }, (_, i) => i + 1))
  })

  it('window and week agree in both directions', () => {
    for (let w = 1; w <= 38; w++) {
      const win = resolveDailySportWeekWindow('SOCCER', 2026, w)!
      expect(dailySportWeekForInstant('SOCCER', 2026, win.start)).toBe(w)
      expect(dailySportWeekForInstant('SOCCER', 2026, new Date(win.end.getTime() - 1))).toBe(w)
    }
  })

  it('[control] NHL is unchanged seven-day arithmetic from its opener', () => {
    expect(resolveDailySportWeekWindow('NHL', 2026, 2)?.start.toISOString()).toBe('2026-10-06T00:00:00.000Z')
    expect(dailySportWeekForInstant('NHL', 2026, new Date('2026-10-06T01:00:00Z'))).toBe(2)
    expect(resolveDailySportWeekWindow('MLB', 2028, 1)).toBeNull()
  })

  it('the roller relabels by gameweek and drops a kickoff inside a break', () => {
    const rows = [
      { week: 0, seasonType: null, startTime: new Date('2026-09-19T14:00:00Z'), status: 'FT', source: 'thesportsdb', fetchedAt: null },
      { week: 0, seasonType: null, startTime: new Date('2026-10-01T23:00:00Z'), status: 'scheduled', source: 'espn_live', fetchedAt: null },
      { week: 0, seasonType: null, startTime: new Date('2026-10-10T14:00:00Z'), status: 'NS', source: 'thesportsdb', fetchedAt: null },
    ] as never
    const out = relabelDailySportWeeks(rows, new Date('2026-08-14T00:00:00Z'), (k) => dailySportWeekForInstant('SOCCER', 2026, k))
    expect(out.map((r) => r.week)).toEqual([6, 7])
  })
})

describe('readWeekSlate — a soccer gameweek', () => {
  const prismaWith = (cache: ReturnType<typeof memoryCache>['db']) =>
    ({ ...cache, sportsGame: { findMany: vi.fn(async () => []) } }) as never

  it('reads all three leagues, and a postponed fixture is a blank that does not hold the week open', async () => {
    byLeague()
    const cache = memoryCache()
    await syncRiSeasonSchedule({ sport: 'SOCCER', season: 2026, db: cache.db as never })
    // Gameweek 5 (11–17 Sep) holds Levante v Athletic, postponed with no new date.
    const window = resolveDailySportWeekWindow('SOCCER', 2026, 5)!
    const slate = await readWeekSlate(prismaWith(cache.db), { sport: 'SOCCER', season: 2026, week: 5, seasonType: 'regular', dateWindow: window })
    const inWeek = LEAGUES.flatMap((l) => parseRiScheduleSeason(ROWS[l])).filter((g) => g.day >= '2026-09-11' && g.day < '2026-09-18')
    expect(slate.games).toBe(inWeek.length)
    expect(inWeek.some((g) => g.status === 'postponed')).toBe(true)
    expect(slate.unfinished).toBe(0)
    expect(slate.final).toBe(inWeek.filter((g) => g.status === 'completed').length)
    expect(slate.source).toBe('rolling_insights_schedule')
  })

  it('a future gameweek is held open by its scheduled games', async () => {
    byLeague()
    const cache = memoryCache()
    await syncRiSeasonSchedule({ sport: 'SOCCER', season: 2026, db: cache.db as never })
    const window = resolveDailySportWeekWindow('SOCCER', 2026, 7)!
    const slate = await readWeekSlate(prismaWith(cache.db), { sport: 'SOCCER', season: 2026, week: 7, seasonType: 'regular', dateWindow: window })
    const inWeek = LEAGUES.flatMap((l) => parseRiScheduleSeason(ROWS[l])).filter((g) => g.day >= '2026-10-09' && g.day < '2026-10-16')
    const scheduled = inWeek.filter((g) => g.status === 'scheduled').length
    expect(scheduled).toBe(30) // ten fixtures per league
    expect(slate.games).toBe(inWeek.length)
    expect(slate.unfinished).toBe(scheduled)
    expect(slate.cancelled).toBe(inWeek.length - scheduled) // replaced rows
  })

  it('[control] NCAAB still holds a week open on a postponed game', async () => {
    const cache = memoryCache()
    cache.store.set('NCAAB:rischedule:2026:meta', {})
    cache.store.set('NCAAB:rischedule:2026:2026-11-03', {
      games: [{ gameId: 'x', day: '2026-11-03', startTime: '2026-11-03T23:00:00.000Z', status: 'postponed', seasonType: 'regular', eventName: null, replacedBy: null }],
    })
    const window = { start: new Date('2026-11-02T00:00:00Z'), end: new Date('2026-11-09T00:00:00Z') }
    const slate = await readWeekSlate(prismaWith(cache.db), { sport: 'NCAAB', season: 2026, week: 1, seasonType: 'regular', dateWindow: window })
    expect(slate.unfinished).toBe(1)
  })
})
