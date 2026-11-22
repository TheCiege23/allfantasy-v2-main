// @vitest-environment node
/**
 * /core's rail prices every league the user holds on every render. Before these caches each league re-read the
 * season's AF rows and rebuilt its board, and the shell took 10-105 s (2026-11-20). These pin the three things the
 * cache must keep true: shared work happens once, each league is still scored by its own rules, and a failure or a
 * miss is never served from the cache.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findLeague = vi.fn()
const findSnapshots = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: (...a: unknown[]) => findLeague(...a) },
    aFProjectionSnapshot: { findMany: (...a: unknown[]) => findSnapshots(...a) },
    fantasyStatLine: { findMany: async () => [] },
    playerGameStat: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/waivers/seasonRatePool', () => ({
  leagueIdColumn: () => null,
  leagueIdOf: () => null,
  loadIdentityForKeys: async () => new Map(),
  resolveRosterIdsToKeys: async () => new Map(),
}))
vi.mock('@/lib/af-projections/leagueProjectionSchedule', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadProjectionSchedule: async () => new Map(),
}))
vi.mock('@/lib/af-projections/nflLeagueWeek', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAfNflWeek: async () => new Map(),
}))

const unavailableSpy = vi.fn(async () => new Map<string, Set<string>>())
vi.mock('@/lib/core-app/unavailableStarters', () => ({ loadUnavailableBySport: (...a: unknown[]) => unavailableSpy(...(a as [])) }))

import { setSharedReadCacheForTests, sharedRead } from '@/lib/af-projections/sharedReadCache'
import { loadLeaguePlayerMetrics } from '@/lib/af-projections/leaguePlayerMetrics'

beforeEach(() => {
  setSharedReadCacheForTests(true)
  findLeague.mockReset()
  findSnapshots.mockReset()
  unavailableSpy.mockClear()
})
afterEach(() => {
  setSharedReadCacheForTests(false)
  vi.useRealTimers()
})

describe('sharedRead', () => {
  it('runs one load for callers that arrive together, and reuses it inside the window', async () => {
    let resolve!: (v: number) => void
    const load = vi.fn(() => new Promise<number>((r) => { resolve = r }))
    const a = sharedRead('t', 'k', 60_000, load)
    const b = sharedRead('t', 'k', 60_000, load)
    resolve(7)
    expect(await a).toBe(7)
    expect(await b).toBe(7)
    expect(await sharedRead('t', 'k', 60_000, load)).toBe(7)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('loads again once the window has passed', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-20T03:00:00Z') })
    const load = vi.fn(async () => 1)
    await sharedRead('t', 'k', 60_000, load)
    vi.setSystemTime(new Date('2026-11-20T03:01:01Z'))
    await sharedRead('t', 'k', 60_000, load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('never serves a failed read: the next call tries again', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(5)
    await expect(sharedRead('t', 'k', 60_000, load)).rejects.toThrow('down')
    expect(await sharedRead('t', 'k', 60_000, load)).toBe(5)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('is off under the test runner unless a test turns it on', async () => {
    setSharedReadCacheForTests(false)
    const load = vi.fn(async () => 1)
    await sharedRead('t', 'k', 60_000, load)
    await sharedRead('t', 'k', 60_000, load)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('league AF boards share one season read', () => {
  const league = (id: string, rec: number) => ({
    id, sport: 'NFL', season: 2026, platform: 'sleeper', platformLeagueId: null, leagueType: 'redraft',
    settings: { scoring_settings: { rec, rec_yd: 0.1 } },
  })
  const snapshot = (playerId: string, rec: number, recYd: number) => ({
    playerId, playerName: `Player ${playerId}`, position: 'WR', adjustmentFactors: { perGameRates: { rec, rec_yd: recYd } },
  })

  beforeEach(() => {
    findLeague.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === 'ppr' ? league('ppr', 1) : league('std', 0)))
    findSnapshots.mockResolvedValue([snapshot('a', 6, 80), snapshot('b', 2, 90)])
  })

  it('reads the season once for two leagues, and still scores each by its own rules', async () => {
    const ppr = await loadLeaguePlayerMetrics({ leagueId: 'ppr', week: 11, includeTradeValues: false })
    const std = await loadLeaguePlayerMetrics({ leagueId: 'std', week: 11, includeTradeValues: false })
    expect(findSnapshots).toHaveBeenCalledTimes(1)
    const perGame = (m: typeof ppr) => Object.fromEntries((m?.rows ?? []).map((r) => [r.playerId, r.perGame]))
    expect(perGame(ppr)).toEqual({ a: 14, b: 11 })
    expect(perGame(std)).toEqual({ a: 8, b: 9 })
  })

  it('reads per league when the cache is off — the control for the test above', async () => {
    setSharedReadCacheForTests(false)
    await loadLeaguePlayerMetrics({ leagueId: 'ppr', week: 11, includeTradeValues: false })
    await loadLeaguePlayerMetrics({ leagueId: 'std', week: 11, includeTradeValues: false })
    expect(findSnapshots).toHaveBeenCalledTimes(2)
  })
})
