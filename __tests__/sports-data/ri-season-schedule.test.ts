/** @vitest-environment node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The NCAAB season schedule for the week finalizer (lib/sports-data/riSeasonSchedule.ts).
 * Every SportsGame schedule for college basketball is incomplete (thesportsdb 2025-26 stops at a
 * 3,000-game cap; week 1 lists 243 games against 310 logged), and a slate short a game can seal a
 * week whose stats miss it. Driven by the committed fixture: RI's whole 2025-26 season.
 */

const h = vi.hoisted(() => ({ riFetchRows: vi.fn() }))
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({
  riFetchRows: (...a: unknown[]) => h.riFetchRows(...a),
}))

import {
  currentScheduleSeason,
  parseRiScheduleSeason,
  readRiScheduleWindow,
  syncRiSeasonSchedule,
} from '@/lib/sports-data/riSeasonSchedule'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'
import { readWeekSlate } from '@/lib/redraft/weekFinalizer'

const FIXTURE = path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', 'schedule-season.NCAABB.json')
const rows = (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { data: { NCAABB: unknown[] } }).data.NCAABB

/** An in-memory SportsDataCache with the four calls the module makes. */
function memoryCache(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed))
  const db = {
    sportsDataCache: {
      upsert: vi.fn(async ({ where, create }: { where: { cacheKey: string }; create: { data: unknown } }) => {
        store.set(where.cacheKey, create.data)
      }),
      deleteMany: vi.fn(async ({ where }: { where: { cacheKey: { startsWith: string; notIn: string[] } } }) => {
        let count = 0
        for (const k of [...store.keys()]) {
          if (k.startsWith(where.cacheKey.startsWith) && !where.cacheKey.notIn.includes(k)) { store.delete(k); count += 1 }
        }
        return { count }
      }),
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

beforeEach(() => vi.clearAllMocks())

describe('parseRiScheduleSeason — against the committed 2025-26 fixture', () => {
  const games = parseRiScheduleSeason(rows)

  it('keeps every game, dated by the Eastern day in its id', () => {
    expect(games).toHaveLength(6027)
    const final = games.find((g) => g.gameId === '20260406-12-103')!
    expect(final.day).toBe('2026-04-06') // tipped 00:50 GMT on the 7th
    expect(final.eventName).toBe('NCAA Tournament')
    expect(final.seasonType).toBe('post')
  })

  it('carries the season type the finalizer filters on', () => {
    expect(games.filter((g) => g.seasonType === 'regular')).toHaveLength(5633)
    expect(games.filter((g) => g.seasonType === 'post')).toHaveLength(394)
  })

  it('keeps replaced games and where they went', () => {
    const replaced = games.filter((g) => g.status === 'replaced')
    expect(replaced).toHaveLength(283)
    expect(replaced.filter((g) => g.replacedBy)).toHaveLength(283)
  })
})

describe('status vocabulary', () => {
  it('REGRESSION: a replaced game is cancelled, not unknown — as unknown it held every week open', () => {
    expect(normalizeGameStatus('replaced')).toBe('cancelled')
    expect(normalizeGameStatus('completed')).toBe('final')
  })
})

describe('syncRiSeasonSchedule', () => {
  it('writes one key per Eastern game day plus a season marker', async () => {
    h.riFetchRows.mockResolvedValue(ok(rows))
    const { store, db } = memoryCache()
    const r = await syncRiSeasonSchedule({ sport: 'NCAAB', season: 2025, db: db as never, now: new Date('2026-09-24T12:00:00Z') })

    expect(h.riFetchRows).toHaveBeenCalledWith('schedule_season', expect.objectContaining({ sport: 'NCAAB', season: 2025 }))
    expect(r.fetched).toBe(true)
    expect(r.games).toBe(6027)
    expect(r.statusCounts).toMatchObject({ final: 5331, completed: 397, replaced: 283, postponed: 12, canceled: 4 })
    expect(store.has('NCAAB:rischedule:2025:2026-04-06')).toBe(true)
    expect(store.get('NCAAB:rischedule:2025:meta')).toMatchObject({ games: 6027, firstDay: '2025-11-02', lastDay: '2026-04-06' })
  })

  it('removes a day that no longer holds games (a rescheduled slate must not linger)', async () => {
    h.riFetchRows.mockResolvedValue(ok(rows))
    const { store, db } = memoryCache({ 'NCAAB:rischedule:2025:2025-12-25': { games: [{ gameId: 'ghost' }] } })
    const r = await syncRiSeasonSchedule({ sport: 'NCAAB', season: 2025, db: db as never })
    expect(r.staleDaysRemoved).toBe(1)
    expect(store.has('NCAAB:rischedule:2025:2025-12-25')).toBe(false)
  })

  it('writes NOTHING on a 304 — the 2026-27 schedule before RI publishes it (GAPS N-16)', async () => {
    h.riFetchRows.mockResolvedValue({ rows: [], notModified: true, unsupported: false, error: null })
    const { store, db } = memoryCache({ 'NCAAB:rischedule:2026:meta': { games: 5 } })
    const r = await syncRiSeasonSchedule({ sport: 'NCAAB', season: 2026, db: db as never })
    expect(r.notModified).toBe(true)
    // Reported AS a 304 — not misdescribed as a malformed 200 by the later empty-payload guard.
    expect(r.error).toBeNull()
    expect(r.fetched).toBe(false)
    expect(db.sportsDataCache.upsert).not.toHaveBeenCalled()
    expect(db.sportsDataCache.deleteMany).not.toHaveBeenCalled()
    expect(store.get('NCAAB:rischedule:2026:meta')).toEqual({ games: 5 })
  })

  it('writes nothing when a 200 carries no parseable game', async () => {
    h.riFetchRows.mockResolvedValue(ok([{ nonsense: true }]))
    const { db } = memoryCache()
    const r = await syncRiSeasonSchedule({ sport: 'NCAAB', season: 2025, db: db as never })
    expect(r.error).toMatch(/refusing to replace a stored schedule with nothing/)
    expect(db.sportsDataCache.upsert).not.toHaveBeenCalled()
  })

  it('fetches the season that started this autumn, or last year before August', () => {
    expect(currentScheduleSeason(new Date('2026-09-24T12:00:00Z'))).toBe(2026)
    expect(currentScheduleSeason(new Date('2027-02-10T12:00:00Z'))).toBe(2026)
  })
})

describe('readWeekSlate — NCAAB reads the RI schedule, never the partial SportsGame feeds', () => {
  const WEEK = { start: new Date('2025-11-10T00:00:00Z'), end: new Date('2025-11-17T00:00:00Z') }
  const prismaWith = (cache: ReturnType<typeof memoryCache>['db']) =>
    ({ ...cache, sportsGame: { findMany: vi.fn(async () => [{ status: 'final', startTime: new Date(), source: 'thesportsdb', fetchedAt: new Date(), season: 2025, week: null }]) } }) as never

  it('an UNSYNCED schedule is an empty slate (which refuses), not a fallback to thesportsdb', async () => {
    const { db } = memoryCache()
    const prisma = prismaWith(db)
    const slate = await readWeekSlate(prisma, { sport: 'NCAAB', season: 2025, week: 2, seasonType: 'regular', dateWindow: WEEK })
    expect(slate.games).toBe(0)
    expect(slate.source).toMatch(/not synced/)
    expect((prisma as { sportsGame: { findMany: ReturnType<typeof vi.fn> } }).sportsGame.findMany).not.toHaveBeenCalled()
  })

  it('counts a synced week: finals, replaced as cancelled, and holds on anything unfinished', async () => {
    h.riFetchRows.mockResolvedValue(ok(rows))
    const cache = memoryCache()
    await syncRiSeasonSchedule({ sport: 'NCAAB', season: 2025, db: cache.db as never })
    const slate = await readWeekSlate(prismaWith(cache.db), { sport: 'NCAAB', season: 2025, week: 2, seasonType: 'regular', dateWindow: WEEK })

    const expected = parseRiScheduleSeason(rows).filter((g) => g.day >= '2025-11-10' && g.day < '2025-11-17' && g.seasonType === 'regular')
    expect(slate.games).toBe(expected.length)
    // 300 regular-season games that week — thesportsdb, the feed this replaces, is capped and short.
    expect(slate.games).toBe(300)
    expect(slate.final + slate.cancelled + slate.unfinished).toBe(slate.games)
    expect(slate.source).toBe('rolling_insights_schedule')
  })

  it('keeps postseason games (conference tournaments, NCAA, NIT) out of the regular slate and in the postseason one', async () => {
    h.riFetchRows.mockResolvedValue(ok(rows))
    const cache = memoryCache()
    await syncRiSeasonSchedule({ sport: 'NCAAB', season: 2025, db: cache.db as never })
    const MARCH = { start: new Date('2026-03-09T00:00:00Z'), end: new Date('2026-03-23T00:00:00Z') }
    const inWindow = parseRiScheduleSeason(rows).filter((g) => g.day >= '2026-03-09' && g.day < '2026-03-23')
    const post = inWindow.filter((g) => g.seasonType === 'post').length
    expect(post).toBeGreaterThan(0) // the control: this window really does hold postseason games

    const regular = await readWeekSlate(prismaWith(cache.db), { sport: 'NCAAB', season: 2025, week: 1, seasonType: 'regular', dateWindow: MARCH })
    const postseason = await readWeekSlate(prismaWith(cache.db), { sport: 'NCAAB', season: 2025, week: 1, seasonType: 'postseason', dateWindow: MARCH })
    expect(regular.games).toBe(inWindow.length - post)
    expect(postseason.games).toBe(post)
  })
})
