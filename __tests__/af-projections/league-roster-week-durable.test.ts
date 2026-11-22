// @vitest-environment node
/**
 * The rail's week boards outlive a deploy (lib/af-projections/leagueRosterWeek.ts, 2026-11-22). A board built by
 * another process — or before a deploy — is read back from Postgres instead of rebuilt; one up to 33 minutes old is
 * served at once and rebuilt behind it; an older one is rebuilt first. Who is ruled out is never cached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
const metrics = vi.fn()
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: (...a: unknown[]) => metrics(...a) }))
const unavailable = vi.fn()
vi.mock('@/lib/core-app/unavailableStarters', () => ({ loadUnavailableBySport: (...a: unknown[]) => unavailable(...a) }))

type Envelope = { data: unknown; fetchedAt: number; source: string; staleAfterMs: number | null }
const table = new Map<string, Envelope>()
const tier = {
  read: vi.fn(async (key: string) => table.get(key) ?? null),
  write: vi.fn(async (key: string, entry: Envelope) => { table.set(key, JSON.parse(JSON.stringify(entry))) }),
}
vi.mock('@/lib/sports-os/durableTier', () => ({ sportsDataCacheTier: () => tier }))

import { setSharedReadCacheForTests } from '@/lib/af-projections/sharedReadCache'
import {
  loadLeagueRosterWeeks,
  rosterWeekBoardKey,
  ROSTER_WEEK_BOARD_SERVE_STALE_MS,
  ROSTER_WEEK_BOARD_TTL_MS,
} from '@/lib/af-projections/leagueRosterWeek'

const board = (points: number) => ({
  leagueId: 'L1', sport: 'NFL', season: 2026, week: 11, unit: 'fantasy points',
  rows: [{ rosterPlayerId: 's1', weekly: points, team: 'BUF', availabilityId: 's1' }],
})
const request = [{ leagueId: 'L1', season: 2026, week: 11, ids: ['s1'] }]
const key = rosterWeekBoardKey('L1', 11, ['s1'])
const stored = (points: number, ageMs: number) =>
  table.set(key, { data: board(points), fetchedAt: Date.now() - ageMs, source: 'live', staleAfterMs: ROSTER_WEEK_BOARD_TTL_MS })

beforeEach(() => {
  setSharedReadCacheForTests(true)
  table.clear()
  tier.read.mockClear(); tier.write.mockClear()
  metrics.mockReset().mockResolvedValue(board(20))
  unavailable.mockReset().mockResolvedValue(new Map())
})
afterEach(() => setSharedReadCacheForTests(false))

describe('rail week boards kept across deploys', () => {
  it('reads a fresh board another process stored instead of rebuilding it', async () => {
    stored(12.5, 60_000)
    const result = await loadLeagueRosterWeeks(request)
    expect(result.get('L1')?.get('s1')?.points).toBe(12.5)
    expect(metrics).not.toHaveBeenCalled()
  })

  it('reads a fresh projection for a recheck even when a previous board is cached', async () => {
    stored(12.5, 60_000)
    expect((await loadLeagueRosterWeeks(request)).get('L1')?.get('s1')?.points).toBe(12.5)
    expect((await loadLeagueRosterWeeks(request, { fresh: true })).get('L1')?.get('s1')?.points).toBe(20)
    expect(metrics).toHaveBeenCalledOnce()
  })

  it('serves a board up to 33 minutes old at once, and rebuilds it behind the view', async () => {
    stored(12.5, ROSTER_WEEK_BOARD_TTL_MS + 60_000)
    const result = await loadLeagueRosterWeeks(request)
    expect(result.get('L1')?.get('s1')?.points).toBe(12.5)
    await vi.waitFor(() => expect(tier.write).toHaveBeenCalledTimes(1))
    expect(metrics).toHaveBeenCalledTimes(1)
    expect((table.get(key)!.data as ReturnType<typeof board>).rows[0].weekly).toBe(20)
  })

  it('waits for a rebuild when the stored board is older than that', async () => {
    stored(12.5, ROSTER_WEEK_BOARD_TTL_MS + ROSTER_WEEK_BOARD_SERVE_STALE_MS + 60_000)
    const result = await loadLeagueRosterWeeks(request)
    expect(result.get('L1')?.get('s1')?.points).toBe(20)
  })

  it('stores a board it builds, so the next process can use it', async () => {
    await loadLeagueRosterWeeks(request)
    expect(tier.write).toHaveBeenCalledWith(key, expect.objectContaining({ data: board(20), source: 'live' }))
  })

  it('still reads who is ruled out on every call, even for a stored board', async () => {
    stored(12.5, 60_000)
    unavailable.mockResolvedValueOnce(new Map([['NFL', new Set(['s1'])]]))
    const result = await loadLeagueRosterWeeks(request)
    expect(result.get('L1')?.get('s1')).toEqual({ points: 0, team: 'BUF', unavailable: true })
    expect((table.get(key)!.data as ReturnType<typeof board>).rows[0].weekly).toBe(12.5)
  })

  it('does not store a league with no board, and a broken Postgres tier never fails the rail', async () => {
    metrics.mockResolvedValueOnce(null)
    expect((await loadLeagueRosterWeeks(request)).has('L1')).toBe(false)
    expect(tier.write).not.toHaveBeenCalled()
    setSharedReadCacheForTests(true)
    tier.read.mockRejectedValueOnce(new Error('db down'))
    tier.write.mockRejectedValueOnce(new Error('db down'))
    expect((await loadLeagueRosterWeeks(request)).get('L1')?.get('s1')?.points).toBe(20)
  })
})

describe('the boards timing line names the slowest leagues', () => {
  it('lists the three slowest boards by league id, slowest first', async () => {
    const { logBoardTiming } = await import('@/lib/af-projections/leagueRosterWeek')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      logBoardTiming(9000, [100, 3700, 260, 2500], [
        { leagueId: 'A', ms: 100 }, { leagueId: 'B', ms: 3700 }, { leagueId: 'C', ms: 260 }, { leagueId: 'D', ms: 2500 },
      ])
      const payload = JSON.parse((info.mock.calls[0] as [string, string])[1])
      expect(payload.slowestLeagues).toEqual([{ leagueId: 'B', ms: 3700 }, { leagueId: 'D', ms: 2500 }, { leagueId: 'C', ms: 260 }])
    } finally { info.mockRestore() }
  })
})
