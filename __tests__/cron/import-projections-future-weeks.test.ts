import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * The future-week phase of /api/cron/import-projections, driven through the real route.
 *
 * 🛑 THE GUARANTEE UNDER TEST: FUTURE WEEKS NEVER REACH `fantasy_projections`. Every current-week
 * reader takes that table's most recently fetched week as "the current week" (`latestProjectionWeek`),
 * and the future phase runs AFTER the current-week phase — so a single future row there would become
 * "this week" everywhere. The first test proves it end to end: the route writes both phases into an
 * in-memory `fantasy_projections` + future store, and then the REAL `latestProjectionWeek()` is asked
 * which week is current.
 *
 * No network: `getWeekBoard` and Sleeper's state are mocked; boards use the shape the existing cron
 * test uses (the Jayden Reed row).
 */

type FpRow = { playerId: string; season: string; week: number; source: string; fetchedAt: Date; projectedPoints: number; stats: unknown }

const h = vi.hoisted(() => ({
  fp: [] as FpRow[],
  future: [] as Array<{ week: number; playerId: string }>,
  tick: 0,
  fetchWithChain: vi.fn(),
  getWeekBoard: vi.fn(),
  resolveCurrentNflWeek: vi.fn(),
  ready: vi.fn(),
  replaceWeek: vi.fn(),
  confirmWeek: vi.fn(),
  recordWeekError: vi.fn(),
  readCheck: vi.fn(),
  pruneThrough: vi.fn(),
  fpUpsert: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workers/api-chain', () => ({ fetchWithChain: h.fetchWithChain }))
vi.mock('@/lib/sports-data/sleeperMarketService', () => ({ getWeekBoard: h.getWeekBoard }))
vi.mock('@/lib/tournament/resolveNflWeek', () => ({ resolveCurrentNflWeek: h.resolveCurrentNflWeek }))
vi.mock('@/lib/projections/futureWeekProjectionStore', () => ({
  futureWeekProjectionsReady: h.ready,
  futureWeekStoreWriter: {
    readCheck: h.readCheck,
    replaceWeek: h.replaceWeek,
    confirmWeek: h.confirmWeek,
    recordWeekError: h.recordWeekError,
    pruneThrough: h.pruneThrough,
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantasyProjection: {
      upsert: h.fpUpsert,
      // Just enough of `findFirst` for latestProjectionWeek: source filter + fetchedAt/season/week desc.
      findFirst: vi.fn(async ({ where }: { where?: { source?: { not?: string } } }) => {
        const rows = h.fp
          .filter((r) => !where?.source?.not || r.source !== where.source.not)
          .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime() || b.season.localeCompare(a.season) || b.week - a.week)
        return rows[0] ? { season: rows[0].season, week: rows[0].week } : null
      }),
    },
    sportsDataCache: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

function boardFor(week: number) {
  return {
    version: 1,
    season: '2026',
    week,
    players: {
      '4046': { playerId: '4046', name: 'Jayden Reed', position: 'WR', team: 'GB', stats: { pts_ppr: 10 + week } },
    },
  }
}

function req(url: string) {
  return new NextRequest(url, { headers: { authorization: 'Bearer cron-secret' } })
}

const URL_NFL = 'https://www.allfantasy.ai/api/cron/import-projections?sport=NFL'

describe('import-projections — future-week phase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.fp = []
    h.future = []
    h.tick = Date.parse('2026-09-22T11:00:00Z')
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-22T11:00:00Z')) // Tuesday of week 3, in season

    h.fetchWithChain.mockResolvedValue({ data: [], fromCache: false, source: 'rolling_insights' })
    h.resolveCurrentNflWeek.mockResolvedValue({ season: 2026, week: 3 })
    h.getWeekBoard.mockImplementation(async (_s: string, w: number) => boardFor(w))
    h.fpUpsert.mockImplementation(async (args: { create: FpRow & { fetchedAt: Date } }) => {
      // Every write lands a little later than the one before, as on a real clock.
      h.tick += 1000
      h.fp.push({ ...args.create, fetchedAt: new Date(h.tick) })
      return {}
    })
    h.ready.mockResolvedValue(true)
    h.readCheck.mockResolvedValue(null)
    h.pruneThrough.mockResolvedValue(0)
    h.confirmWeek.mockResolvedValue(undefined)
    h.recordWeekError.mockResolvedValue(undefined)
    h.replaceWeek.mockImplementation(async (input: { week: number; lines: Array<{ playerId: string }> }) => {
      h.tick += 1000
      for (const l of input.lines) h.future.push({ week: input.week, playerId: l.playerId })
      return input.lines.length
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('🛑 future weeks go to their own store, and the current week stays the current week for every reader', async () => {
    const { GET } = await import('@/app/api/cron/import-projections/route')
    const res = await GET(req(URL_NFL))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results.NFL).toMatchObject({ ok: true, synced: 1, source: 'sleeper' })

    // Nothing but week 3 ever reached fantasy_projections…
    expect(h.fpUpsert).toHaveBeenCalled()
    expect(new Set(h.fp.map((r) => r.week))).toEqual(new Set([3]))
    // …the next four weeks went to the future store…
    expect([...new Set(h.future.map((r) => r.week))]).toEqual([4, 5, 6, 7])
    expect(body.futureWeeks).toMatchObject({ ran: true, anchorWeek: 3 })
    expect(body.futureWeeks.weeks.map((w: { outcome: string }) => w.outcome)).toEqual(['written', 'written', 'written', 'written'])

    // …and the REAL current-week resolver, run after both phases, still answers week 3.
    const { latestProjectionWeek } = await import('@/lib/core-app/playerProjections')
    expect(await latestProjectionWeek()).toEqual({ season: '2026', week: 3 })
  })

  it("asks Sleeper for its week once, and anchors the future on that answer", async () => {
    const { GET } = await import('@/app/api/cron/import-projections/route')
    await GET(req(URL_NFL))
    expect(h.resolveCurrentNflWeek).toHaveBeenCalledTimes(1)
    expect(h.pruneThrough).toHaveBeenCalledWith({ sport: 'NFL', season: '2026', throughWeek: 3 })
  })

  it('before the migration it is a reported no-op: only the current week is fetched', async () => {
    h.ready.mockResolvedValue(false)
    const { GET } = await import('@/app/api/cron/import-projections/route')
    const res = await GET(req(URL_NFL))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.futureWeeks).toMatchObject({ ran: false })
    expect(body.futureWeeks.reason).toMatch(/not migrated/)
    expect(h.getWeekBoard.mock.calls.map((c) => c[1])).toEqual([3])
    expect(h.replaceWeek).not.toHaveBeenCalled()
  })

  it('a failing future phase can never fail the current-week run', async () => {
    h.ready.mockRejectedValue(new Error('probe exploded'))
    const { GET } = await import('@/app/api/cron/import-projections/route')
    const res = await GET(req(URL_NFL))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.results.NFL.ok).toBe(true)
    expect(body.futureWeeks).toMatchObject({ ran: false, error: 'probe exploded' })
  })

  it('every future week erroring still leaves the run green and the current week written', async () => {
    h.replaceWeek.mockRejectedValue(new Error('db down'))
    const { GET } = await import('@/app/api/cron/import-projections/route')
    const res = await GET(req(URL_NFL))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results.NFL).toMatchObject({ ok: true, synced: 1 })
    expect(body.futureWeeks.weeks.every((w: { outcome: string }) => w.outcome === 'error')).toBe(true)
    expect(body.failedSports).toBeUndefined()
  })

  it('a hand-run ?week= leaves future weeks alone', async () => {
    const { GET } = await import('@/app/api/cron/import-projections/route')
    const res = await GET(req(`${URL_NFL}&week=5`))
    const body = await res.json()

    expect(body.futureWeeks).toMatchObject({ ran: false })
    expect(h.ready).not.toHaveBeenCalled()
    expect(h.getWeekBoard.mock.calls.map((c) => c[1])).toEqual([5])
  })

  it('outside the season (unforced) the phase does not run at all', async () => {
    vi.setSystemTime(new Date('2026-05-01T12:00:00Z'))
    const { GET } = await import('@/app/api/cron/import-projections/route')
    const res = await GET(req(URL_NFL))
    const body = await res.json()

    expect(body.futureWeeks).toBeUndefined()
    expect(h.ready).not.toHaveBeenCalled()
  })

  it('when Sleeper cannot name the week, nothing future is fetched either', async () => {
    h.resolveCurrentNflWeek.mockResolvedValue(null)
    const { GET } = await import('@/app/api/cron/import-projections/route')
    const res = await GET(req(URL_NFL))
    const body = await res.json()

    expect(body.futureWeeks).toMatchObject({ ran: false })
    expect(h.getWeekBoard).not.toHaveBeenCalled()
    expect(h.resolveCurrentNflWeek).toHaveBeenCalledTimes(1)
  })
})
