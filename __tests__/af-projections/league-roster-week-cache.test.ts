// @vitest-environment node
/**
 * The rail's per-league week board (lib/af-projections/leagueRosterWeek.ts) is reused for a few minutes, 2026-11-20:
 * the /core shell, the rail-scores refresh and the league page each price every league the user holds, and
 * rebuilding ~85 boards per render took the shell to 10-105 s. Who is ruled out must still be read on every call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
const metrics = vi.fn()
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: (...a: unknown[]) => metrics(...a) }))
const unavailable = vi.fn()
vi.mock('@/lib/core-app/unavailableStarters', () => ({ loadUnavailableBySport: (...a: unknown[]) => unavailable(...a) }))

import { setSharedReadCacheForTests } from '@/lib/af-projections/sharedReadCache'
import { loadLeagueRosterWeeks } from '@/lib/af-projections/leagueRosterWeek'

const board = (leagueId: string) => ({
  leagueId, sport: 'NFL', season: 2026, week: 11, unit: 'fantasy points',
  rows: [
    { rosterPlayerId: 's1', weekly: 12.5, team: 'BUF', availabilityId: 's1' },
    { rosterPlayerId: 's2', weekly: 8, team: 'KC', availabilityId: 's2' },
  ],
})
const requests = (ids = ['s1', 's2']) => [
  { leagueId: 'L1', season: 2026, week: 11, ids },
  { leagueId: 'L2', season: 2026, week: 11, ids },
]

beforeEach(() => {
  setSharedReadCacheForTests(true)
  metrics.mockReset().mockImplementation(async ({ leagueId }: { leagueId: string }) => board(leagueId))
  unavailable.mockReset().mockResolvedValue(new Map())
})
afterEach(() => setSharedReadCacheForTests(false))

describe('the rail week board cache', () => {
  it('builds each league board once across repeat renders, in any id order', async () => {
    const first = await loadLeagueRosterWeeks(requests())
    const second = await loadLeagueRosterWeeks(requests(['s2', 's1']))
    expect(metrics).toHaveBeenCalledTimes(2)
    expect(second.get('L1')?.get('s1')).toEqual({ points: 12.5, team: 'BUF', unavailable: false })
    expect(second).toEqual(first)
  })

  it('still reads who is ruled out on every call, and does not leak it into the cached board', async () => {
    await loadLeagueRosterWeeks(requests())
    unavailable.mockResolvedValueOnce(new Map([['NFL', new Set(['s1'])]]))
    const ruledOut = await loadLeagueRosterWeeks(requests())
    expect(ruledOut.get('L1')?.get('s1')).toEqual({ points: 0, team: 'BUF', unavailable: true })
    const cleared = await loadLeagueRosterWeeks(requests())
    expect(cleared.get('L1')?.get('s1')).toEqual({ points: 12.5, team: 'BUF', unavailable: false })
    expect(unavailable).toHaveBeenCalledTimes(3)
    expect(metrics).toHaveBeenCalledTimes(2)
  })

  it('does not keep a league with no board: the next render asks again', async () => {
    metrics.mockImplementation(async ({ leagueId }: { leagueId: string }) => (leagueId === 'L2' ? null : board(leagueId)))
    const first = await loadLeagueRosterWeeks(requests())
    expect(first.has('L2')).toBe(false)
    await loadLeagueRosterWeeks(requests())
    expect(metrics.mock.calls.filter(([a]) => (a as { leagueId: string }).leagueId === 'L2')).toHaveLength(2)
    expect(metrics.mock.calls.filter(([a]) => (a as { leagueId: string }).leagueId === 'L1')).toHaveLength(1)
  })

  it('a different roster is a different board', async () => {
    await loadLeagueRosterWeeks(requests())
    await loadLeagueRosterWeeks(requests(['s1', 's3']))
    expect(metrics).toHaveBeenCalledTimes(4)
  })
})

describe('the rail week boards: a pool of four, not lockstep batches (2026-11-22)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ leagueId: `L${i}`, season: 2026, week: 11, ids: ['s1', 's2'] }))
  function gate() { let open!: () => void; const p = new Promise<void>((r) => { open = r }); return { p, open } }

  it('starts the fifth board as soon as one of the first four finishes, never more than four at once', async () => {
    setSharedReadCacheForTests(false)
    const first = gate(); const rest = gate(); let running = 0; let peak = 0
    metrics.mockImplementation(async ({ leagueId }: { leagueId: string }) => {
      running++; peak = Math.max(peak, running)
      try { await (leagueId === 'L0' ? first.p : rest.p); return board(leagueId) } finally { running-- }
    })
    const done = loadLeagueRosterWeeks(many(6))
    try {
      await vi.waitFor(() => expect(metrics).toHaveBeenCalledTimes(4))
      first.open()
      // L1–L3 are still building: lockstep batches would not have started L4 yet.
      await vi.waitFor(() => expect(metrics).toHaveBeenCalledTimes(5))
    } finally { first.open(); rest.open() }
    const result = await done
    expect(peak).toBe(4)
    expect([...result.keys()].sort()).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5'])
  })

  it('says where the boards came from when loading them is slow, and nothing when it is fast', async () => {
    const { logBoardTiming } = await import('@/lib/af-projections/leagueRosterWeek')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      logBoardTiming(900, [{ leagueId: 'A', ms: 800, source: 'built' }])
      expect(info).not.toHaveBeenCalled()
      logBoardTiming(12_500, [
        { leagueId: 'A', ms: 1, source: 'memory' }, { leagueId: 'B', ms: 40, source: 'stored' },
        { leagueId: 'C', ms: 300, source: 'built' }, { leagueId: 'D', ms: 900, source: 'built' },
        { leagueId: 'E', ms: 4000, source: 'built' }, { leagueId: 'F', ms: 30, source: 'stale' },
        { leagueId: 'G', ms: 5, source: 'failed' },
      ])
      expect(info).toHaveBeenCalledTimes(1)
      const [tag, payload] = info.mock.calls[0] as [string, string]
      expect(tag).toBe('[rail-boards-timing]')
      expect(JSON.parse(payload)).toEqual({
        boards: 7, built: 3, stored: 1, stale: 1, memory: 1, failed: 1, bound: 4, totalMs: 12_500,
        slowestMs: 4000, medianBuildMs: 900,
        slowestLeagues: [{ leagueId: 'E', ms: 4000, source: 'built' }, { leagueId: 'D', ms: 900, source: 'built' }, { leagueId: 'C', ms: 300, source: 'built' }],
      })
    } finally { info.mockRestore() }
  })
})
