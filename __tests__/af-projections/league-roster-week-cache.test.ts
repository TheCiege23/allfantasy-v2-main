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
