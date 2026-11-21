import { describe, expect, it, vi } from 'vitest'

/**
 * Manager Psychology, Cron axis (owner's "daily current-season refresh", 2026-11-21): ESPN and MFL waiver claims are
 * re-read once a day, this season only, through the import's own fetch and the backfill's own row builder.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const {
  refreshProviderWaivers,
  perTickFor,
  lapDays,
  currentSeasonFloor,
  PROVIDER_WAIVER_MAX_PER_TICK,
  PROVIDER_WAIVER_SLOT_MS,
  PROVIDER_WAIVER_MIN_RUNWAY_MS,
} = await import('@/lib/league-import/providerWaiverRefresh')
const { espnTransactionFactRows } = await import('@/lib/league-import/espn/EspnHistoricalBackfillService')
const { mflTransactionFactRows } = await import('@/lib/league-import/mfl/MflHistoricalBackfillService')

const league = (i: number, platform = 'espn') => ({ id: `L${String(i).padStart(3, '0')}`, platform, platformLeagueId: `p${i}`, season: 2026, userId: `u${i}` })
const claim = (leagueId: string) => ({ provider: 'espn', upstreamTransactionId: 't1', entryIndex: 0, leagueId, sport: 'NFL', type: 'waiver_add', payload: {} })

const deps = (leagues: ReturnType<typeof league>[], over: Record<string, unknown> = {}) => ({
  listLeagues: vi.fn(async () => leagues),
  readRows: vi.fn(async (l: { id: string }) => [claim(l.id), { ...claim(l.id), type: 'waiver_drop', entryIndex: 1 }]),
  persist: vi.fn(async (rows: unknown[]) => rows.length),
  remainingMs: () => 200_000,
  now: () => 0,
  ...over,
})

describe('the rotation', () => {
  it('takes enough leagues a tick that every league comes round once a day, within the cap', () => {
    expect(perTickFor(0)).toBe(1)
    expect(perTickFor(10)).toBe(3)
    expect(perTickFor(48)).toBe(12)
    expect(perTickFor(500)).toBe(PROVIDER_WAIVER_MAX_PER_TICK)
    expect(lapDays(48)).toBe(1)
    expect(lapDays(100)).toBe(3)
  })

  it('four six-hour slots cover every league exactly once a day', async () => {
    const leagues = Array.from({ length: 10 }, (_, i) => league(i))
    const seen: string[] = []
    for (let slot = 0; slot < 4; slot++) {
      const d = deps(leagues, { now: () => slot * PROVIDER_WAIVER_SLOT_MS })
      await refreshProviderWaivers(d, {})
      seen.push(...d.readRows.mock.calls.map((c) => (c[0] as { id: string }).id))
    }
    expect(new Set(seen)).toEqual(new Set(leagues.map((l) => l.id)))
  })

  it('this season only: the floor is last year until March, then this year', () => {
    expect(currentSeasonFloor(new Date('2027-02-10T00:00:00Z'))).toBe(2026)
    expect(currentSeasonFloor(new Date('2026-11-21T00:00:00Z'))).toBe(2026)
  })
})

describe('a tick', () => {
  it('reads each picked league once, persists its rows, and counts the waiver claims', async () => {
    const d = deps([league(1), league(2, 'mfl')])
    const r = await refreshProviderWaivers(d, {})
    expect(d.listLeagues).toHaveBeenCalledWith(currentSeasonFloor(new Date(0)))
    expect(r).toMatchObject({ leagues: 2, picked: 1, refreshed: 1, claimsRead: 1, factsWritten: 2, errors: [] })
  })

  it('stops starting leagues when the run budget is short, and says how many it deferred', async () => {
    const d = deps(Array.from({ length: 40 }, (_, i) => league(i)), { remainingMs: () => PROVIDER_WAIVER_MIN_RUNWAY_MS - 1 })
    const r = await refreshProviderWaivers(d, {})
    expect(d.readRows).not.toHaveBeenCalled()
    expect(r.deferred).toBe(r.picked)
  })

  it('one league failing costs only that league', async () => {
    const leagues = Array.from({ length: 8 }, (_, i) => league(i))
    const d = deps(leagues, { readRows: vi.fn(async (l: { id: string }) => { if (l.id === 'L000') throw new Error('espn 401'); return [claim(l.id)] }) })
    const r = await refreshProviderWaivers(d, {})
    expect(r.errors).toEqual(['espn L000: espn 401'])
    expect(r.refreshed).toBe(r.picked - 1)
  })

  it('PROVIDER_WAIVER_REFRESH=off reads nothing', async () => {
    const d = deps([league(1)])
    expect(await refreshProviderWaivers(d, { PROVIDER_WAIVER_REFRESH: 'off' })).toMatchObject({ off: true, picked: 0 })
    expect(d.listLeagues).not.toHaveBeenCalled()
  })
})

describe('one row builder, shared with the backfill', () => {
  it('ESPN: a waiver claim becomes the same waiver_add fact the backfill writes, with the team and the bid', () => {
    const payload = {
      league: { season: 2026, sport: 'NFL' },
      transactions: [{ transactionId: 'tx9', type: 'waiver', adds: { p77: 'team3' }, drops: {}, status: 'EXECUTED', bidAmount: 12, createdAt: '2026-11-18T10:00:00Z' }],
    }
    const rows = espnTransactionFactRows('L1', payload as never)
    expect(rows).toEqual([
      expect.objectContaining({ provider: 'espn', upstreamTransactionId: 'tx9', leagueId: 'L1', type: 'waiver_add', playerId: 'p77', managerId: 'team3', rosterId: 'team3', season: 2026, payload: expect.objectContaining({ bidAmount: 12 }) }),
    ])
  })

  it('MFL: the same, with no bid', () => {
    const payload = {
      league: { season: 2026, sport: 'NFL' },
      transactions: [{ transactionId: 'm1', type: 'waiver', adds: { p5: '0004' }, drops: {}, createdAt: '2026-11-18T10:00:00Z' }],
    }
    const rows = mflTransactionFactRows('L2', payload as never)
    expect(rows[0]).toMatchObject({ provider: 'mfl', leagueId: 'L2', type: 'waiver_add', managerId: '0004', season: 2026 })
  })
})
