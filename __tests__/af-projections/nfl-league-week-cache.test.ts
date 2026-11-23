// @vitest-environment node
/**
 * One week's AF NFL lines are reused for five minutes in a process (lib/af-projections/nflLeagueWeek.ts,
 * 2026-11-22; it was 60 seconds). The rows behind them are recomputed once a day, and turning them into lines cost
 * ~0.8 s on a busy process, which nearly every /core open more than a minute apart used to pay.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const snapshot = vi.fn(async () => [])
vi.mock('@/lib/prisma', () => ({
  prisma: {
    aFProjectionSnapshot: { findMany: () => snapshot() },
    playerIdentityMap: { findMany: async () => [] },
    fantasyStatLine: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/af-projections/leagueProjectionSchedule', () => ({
  loadProjectionSchedule: async () => new Map(),
  projectionTeamKey: (_sport: string, team: string | null) => team,
}))
vi.mock('@/lib/af-projections/nflSpecialistRates', () => ({ loadNflSpecialistRates: async () => new Map() }))

import { AF_NFL_WEEK_TTL_MS, loadAfNflWeek } from '@/lib/af-projections/nflLeagueWeek'

afterEach(() => vi.useRealTimers())

describe('AF NFL week lines, reused for five minutes', () => {
  it('reuses one read for two minutes, and reads again after six', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-22T12:00:00Z'))
    await loadAfNflWeek({ season: '2026', week: 12 })
    vi.setSystemTime(new Date('2026-11-22T12:02:00Z'))
    await loadAfNflWeek({ season: '2026', week: 12 })
    expect(snapshot).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-11-22T12:08:00Z'))
    await loadAfNflWeek({ season: '2026', week: 12 })
    expect(snapshot).toHaveBeenCalledTimes(2)
  })

  it('states the window it keeps', () => {
    expect(AF_NFL_WEEK_TTL_MS).toBe(5 * 60_000)
  })
})
