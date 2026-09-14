import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  enumerate: vi.fn(),
  runDue: vi.fn(),
  stateFind: vi.fn(),
  leagueFind: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSyncState: { findMany: h.stateFind },
    league: { findMany: h.leagueFind },
  },
}))
vi.mock('@/lib/import-os/collector/enumerate', () => ({ enumerateConnectedLeagues: h.enumerate }))
vi.mock('@/lib/import-os/collector/runDueSleeperLeagues', () => ({ runDueLeagues: h.runDue }))

import {
  ACTIVE_SYNC_CADENCE_MINUTES,
  ACTIVE_SYNC_LEAGUE_TIMEOUT_MS,
  runActiveSyncLane,
  selectActiveSyncConnections,
} from '@/lib/import-os/collector/activeSyncLane'

beforeEach(() => {
  vi.clearAllMocks()
  h.enumerate.mockImplementation(async ([provider]: [string]) => [
    { runKey: `${provider}:L-${provider}:2026`, provider, externalLeagueId: `L-${provider}`, season: 2026, sport: 'NFL' },
    { runKey: `${provider}:old-${provider}:2025`, provider, externalLeagueId: `old-${provider}`, season: 2025, sport: 'NFL' },
  ])
  h.stateFind.mockResolvedValue([])
  h.leagueFind.mockResolvedValue([])
  h.runDue.mockResolvedValue({
    enumerated: 6, executed: 6, completed: 6, partial: 0, failed: 0, locked: 0,
    notDue: 0, skipped: 0, errored: 0, byProvider: {}, results: [],
  })
})

describe('active provider sync lane', () => {
  it('selects the current in-season league for every supported provider and isolates its state key', async () => {
    const selected = await selectActiveSyncConnections({ now: new Date('2026-09-13T18:00:00Z'), limitPerProvider: 2 })
    expect(selected.eligible).toBe(6)
    expect(selected.connections).toHaveLength(6)
    expect(new Set(selected.connections.map((row) => row.provider))).toEqual(
      new Set(['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']),
    )
    expect(selected.connections.every((row) => row.runKey.endsWith(':active'))).toBe(true)
  })

  it('runs only mutable scopes on the five-minute cadence', async () => {
    await runActiveSyncLane({ now: new Date('2026-09-13T18:00:00Z'), limitPerProvider: 1 })
    expect(h.runDue).toHaveBeenCalledWith(expect.objectContaining({
      cadenceMinutesOverride: ACTIVE_SYNC_CADENCE_MINUTES,
      scopes: ['transactions', 'teams_rosters'],
      matchupStaleThresholdMs: 5 * 60_000,
      runTimeoutMs: ACTIVE_SYNC_LEAGUE_TIMEOUT_MS,
    }))
  })
})
