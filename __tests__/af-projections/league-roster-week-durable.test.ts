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

describe('the boards timing line says where each board came from (2026-11-22)', () => {
  /*
   * 🛑 TIMING ALONE COULD NOT TELL A STORED BOARD FROM A REBUILT ONE. The first version called anything slower than
   * 5 ms "rebuilt"; once boards came from Postgres, a stored read is slower than that, and production logged
   * "47 of 47 rebuilt" for boards that were read, not built. These read the line a real load writes.
   */
  async function sourcesOf(run: () => Promise<unknown>) {
    const { __setBoardTimingThresholdForTests } = await import('@/lib/af-projections/leagueRosterWeek')
    __setBoardTimingThresholdForTests(0)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      await run()
      const line = info.mock.calls.find(([tag]) => tag === '[rail-boards-timing]') as [string, string] | undefined
      return JSON.parse(line![1]) as Record<string, number>
    } finally {
      info.mockRestore()
      __setBoardTimingThresholdForTests(1500)
    }
  }

  it('a fresh stored board is "stored", not "built"', async () => {
    stored(12.5, 60_000)
    const line = await sourcesOf(() => loadLeagueRosterWeeks(request))
    expect(line).toMatchObject({ boards: 1, stored: 1, built: 0, stale: 0, memory: 0 })
  })

  it('a 3–33 minute old board is "stale"', async () => {
    stored(12.5, ROSTER_WEEK_BOARD_TTL_MS + 60_000)
    const line = await sourcesOf(() => loadLeagueRosterWeeks(request))
    expect(line).toMatchObject({ stale: 1, built: 0 })
    await vi.waitFor(() => expect(tier.write).toHaveBeenCalled())
  })

  it('no board anywhere is "built", and the next call in this process is "memory"', async () => {
    expect(await sourcesOf(() => loadLeagueRosterWeeks(request))).toMatchObject({ built: 1, stored: 0 })
    expect(await sourcesOf(() => loadLeagueRosterWeeks(request))).toMatchObject({ memory: 1, built: 0 })
  })
})
