import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  enumerate: vi.fn(),
  runDue: vi.fn(),
  stateFind: vi.fn(),
  leagueFind: vi.fn(),
  gameDay: vi.fn(async (_now: Date) => false),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSyncState: { findMany: h.stateFind },
    league: { findMany: h.leagueFind },
  },
}))
vi.mock('@/lib/import-os/collector/enumerate', () => ({ enumerateConnectedLeagues: h.enumerate }))
vi.mock('@/lib/import-os/collector/runDueSleeperLeagues', () => ({ runDueLeagues: h.runDue }))
vi.mock('@/lib/import-os/collector/gameDayWindow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/import-os/collector/gameDayWindow')>()),
  isNflGameDayWindow: h.gameDay,
}))

import {
  ACTIVE_SYNC_CADENCE_MINUTES,
  ACTIVE_SYNC_LEAGUE_TIMEOUT_MS,
  ACTIVE_SYNC_START_BUDGET_MS,
  GAME_DAY_MAX_PER_PROVIDER,
  activeSliceSize,
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
  h.gameDay.mockResolvedValue(false)
  h.runDue.mockResolvedValue({
    enumerated: 6, executed: 6, completed: 6, partial: 0, failed: 0, locked: 0,
    notDue: 0, skipped: 0, errored: 0, byProvider: {}, results: [],
  })
})

describe('active provider sync lane', () => {
  it('refreshes current college-football leagues when their season calendar is unavailable', async () => {
    h.enumerate.mockImplementation(async ([provider]: [string]) => provider === 'fantrax' ? [
      { runKey: 'fantrax:college:2026', provider, externalLeagueId: 'college', season: 2026, sport: 'NCAAF' },
      { runKey: 'fantrax:archive:2025', provider, externalLeagueId: 'archive', season: 2025, sport: 'NCAAF' },
    ] : [])
    const selected = await selectActiveSyncConnections({ now: new Date('2026-09-27T17:00:00Z') })
    expect(selected.connections.map(row => row.runKey)).toEqual(['fantrax:college:2026:active'])
    await runActiveSyncLane({ now: new Date('2026-09-27T17:00:00Z') })
    expect(h.runDue).toHaveBeenCalledWith(expect.objectContaining({
      cadenceMinutesOverride: 5,
      scopes: ['league_state', 'transactions', 'teams_rosters'],
    }))
  })

  it('still excludes a known offseason from the active lane', async () => {
    const selected = await selectActiveSyncConnections({ now: new Date('2026-06-15T17:00:00Z') })
    expect(selected.connections).toEqual([])
  })

  it('selects the current in-season league for every supported provider and isolates its state key', async () => {
    const selected = await selectActiveSyncConnections({ now: new Date('2026-09-13T18:00:00Z'), limitPerProvider: 2 })
    expect(selected.eligible).toBe(6)
    expect(selected.connections).toHaveLength(6)
    expect(new Set(selected.connections.map((row) => row.provider))).toEqual(
      new Set(['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']),
    )
    expect(selected.connections.every((row) => row.runKey.endsWith(':active'))).toBe(true)
  })

  /*
   * A league the provider said is gone stops advancing its attempt time for a day, so the
   * oldest-attempt ordering would otherwise hand it a Sleeper slot on every five-minute tick.
   */
  it('does not spend a slot on a league the provider said is gone', async () => {
    const now = new Date('2026-09-13T18:00:00Z')
    h.stateFind.mockResolvedValue([
      {
        runKey: 'sleeper:L-sleeper:2026:active',
        syncStatus: 'skipped',
        lastError: 'league gone at provider: sleeper: League not found.',
        lastAttemptedSyncAt: new Date(now.getTime() - 60 * 60_000),
      },
    ])
    const selected = await selectActiveSyncConnections({ now, limitPerProvider: 2 })
    expect(selected.connections.some((row) => row.provider === 'sleeper')).toBe(false)
    expect(selected.connections).toHaveLength(5)
  })

  it('runs only mutable scopes on the five-minute cadence', async () => {
    await runActiveSyncLane({ now: new Date('2026-09-13T18:00:00Z'), limitPerProvider: 1 })
    expect(h.runDue).toHaveBeenCalledWith(expect.objectContaining({
      cadenceMinutesOverride: ACTIVE_SYNC_CADENCE_MINUTES,
      scopes: ['league_state', 'transactions', 'teams_rosters'],
      matchupStaleThresholdMs: 5 * 60_000,
      runTimeoutMs: ACTIVE_SYNC_LEAGUE_TIMEOUT_MS,
    }))
  })

  it('keeps the fixed slice when it is not a game day', async () => {
    await runActiveSyncLane({ now: new Date('2026-09-30T16:00:00Z'), limitPerProvider: 1 })
    expect(h.gameDay).toHaveBeenCalledTimes(1)
    const call = h.runDue.mock.calls[0][0] as { connections: Array<{ provider: string }> }
    expect(call.connections).toHaveLength(6)
  })
})

describe('game-day sizing', () => {
  it('takes enough leagues per tick for every league to come round in 20 minutes', () => {
    // 20-minute target over a 5-minute cadence = 4 ticks.
    expect(activeSliceSize({ eligibleForProvider: 307, limitPerProvider: 4, gameDay: true })).toBe(77)
    // Off a game day: 60-minute target over a 5-minute cadence = 12 ticks → ceil(307 / 12) = 26.
    // (It was a fixed 4 — a ~6-hour lap; see OFF_DAY_REFRESH_TARGET_MINUTES.)
    expect(activeSliceSize({ eligibleForProvider: 307, limitPerProvider: 4, gameDay: false })).toBe(26)
    expect(activeSliceSize({ eligibleForProvider: 20, limitPerProvider: 4, gameDay: false })).toBe(4)
    expect(activeSliceSize({ eligibleForProvider: 5_000, limitPerProvider: 4, gameDay: false })).toBe(
      GAME_DAY_MAX_PER_PROVIDER,
    )
    // Never below the requested floor, never above the cap.
    expect(activeSliceSize({ eligibleForProvider: 6, limitPerProvider: 4, gameDay: true })).toBe(4)
    expect(activeSliceSize({ eligibleForProvider: 5_000, limitPerProvider: 4, gameDay: true })).toBe(
      GAME_DAY_MAX_PER_PROVIDER,
    )
  })

  function manySleeper(n: number) {
    h.enumerate.mockImplementation(async ([provider]: [string]) =>
      provider === 'sleeper'
        ? Array.from({ length: n }, (_, i) => ({
            runKey: `sleeper:S${i}:2026`, provider, externalLeagueId: `S${i}`, season: 2026, sport: 'NFL',
          }))
        : [{ runKey: `${provider}:L-${provider}:2026`, provider, externalLeagueId: `L-${provider}`, season: 2026, sport: 'NFL' }],
    )
  }

  it('sizes the slice from the schedule-driven game-day read', async () => {
    manySleeper(40)
    h.gameDay.mockResolvedValue(true)
    const result = await runActiveSyncLane({ now: new Date('2026-09-27T18:00:00Z'), limitPerProvider: 4 })
    const call = h.runDue.mock.calls[0][0] as { connections: Array<{ provider: string }> }
    expect(call.connections.filter((c) => c.provider === 'sleeper')).toHaveLength(10)
    expect(result.gameDay).toBe(true)
  })

  /*
   * A tick can now run out of start budget, and leagues start in list order. Concatenated
   * Sleeper-first, the one ESPN league would sit behind ten Sleeper leagues every tick.
   */
  it('interleaves providers so a large provider cannot starve a small one of the start budget', async () => {
    manySleeper(40)
    const selected = await selectActiveSyncConnections({
      now: new Date('2026-09-27T18:00:00Z'),
      limitPerProvider: 4,
      gameDay: true,
    })
    expect(new Set(selected.connections.slice(0, 6).map((c) => c.provider))).toEqual(
      new Set(['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker']),
    )
  })

  it('bounds when new leagues may start, measured from the start of the tick', async () => {
    let t = 1_000_000
    await runActiveSyncLane({ now: new Date('2026-09-27T18:00:00Z'), gameDay: true, clock: () => t })
    const call = h.runDue.mock.calls[0][0] as { startDeadlineAt: number; clock: () => number }
    expect(call.startDeadlineAt).toBe(1_000_000 + ACTIVE_SYNC_START_BUDGET_MS)
    t = 2
    expect(call.clock()).toBe(2)
    // An explicit override skips the schedule read.
    expect(h.gameDay).not.toHaveBeenCalled()
  })
})

it('does not let a recently viewed league starve an overdue refresh', async () => {
  const now = new Date('2026-09-13T18:00:00Z')
  h.enumerate.mockImplementation(async ([provider]) => provider === 'sleeper' ? ['busy', 'overdue'].map(id => ({ runKey: 'sleeper:' + id + ':2026', provider, externalLeagueId: id, season: 2026, sport: 'NFL' })) : [])
  h.stateFind.mockResolvedValue([{ runKey: 'sleeper:busy:2026:active', lastAttemptedSyncAt: new Date(now.getTime()-5*60_000) }, { runKey: 'sleeper:overdue:2026:active', lastAttemptedSyncAt: new Date(now.getTime()-50*60_000) }])
  h.leagueFind.mockResolvedValue([{ platform: 'sleeper', platformLeagueId: 'busy', season: 2026, lastViewedAt: now }])
  const result = await selectActiveSyncConnections({ now, limitPerProvider: 1 })
  expect(result.connections[0].externalLeagueId).toBe('overdue')
})
