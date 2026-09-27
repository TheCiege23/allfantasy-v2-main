/**
 * Game-day freshness for imported leagues: the schedule-driven window and the start budget.
 *
 * The lane's slice sizing is pinned in `active-provider-sync-lane.test.ts`; this file pins the two
 * pieces that decide WHEN it fires and what a tick does when it runs out of time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sportsGameFindFirst: vi.fn(async (_args: unknown): Promise<{ startTime: Date | null } | null> => null),
  sync: vi.fn(async (connection: { runKey: string }, _now: Date, _opts: unknown) => ({
    runKey: connection.runKey,
    executed: true,
    due: true,
    status: 'completed' as const,
    seasonState: 'regular_season' as const,
    cadenceMinutes: 5,
    nextEligibleAt: new Date().toISOString(),
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { sportsGame: { findFirst: h.sportsGameFindFirst } } }))
vi.mock('@/lib/import-os/collector/syncConnectedSleeperLeague', () => ({ syncConnectedLeague: h.sync }))
vi.mock('@/lib/import-os/collector/enumerate', () => ({ enumerateConnectedLeagues: vi.fn(async () => []) }))

import {
  GAME_DAY_LEAD_MS,
  GAME_DAY_TAIL_MS,
  isInGameDayWindow,
  isNflGameDayWindow,
} from '@/lib/import-os/collector/gameDayWindow'
import { runDueLeagues } from '@/lib/import-os/collector/runDueSleeperLeagues'
import type { LeagueSyncConnection } from '@/lib/import-os/collector/types'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NFL game-day window', () => {
  // Sunday 2026-09-27, 1:00pm ET kickoff = 17:00Z.
  const sundayEarly = new Date('2026-09-27T17:00:00Z')
  // Monday night, 8:15pm ET = 00:15Z on TUESDAY — the case a UTC-weekday rule misses.
  const mondayNight = new Date('2026-09-29T00:15:00Z')

  it('opens before the first kickoff and stays open after the last', () => {
    expect(isInGameDayWindow([sundayEarly], new Date(sundayEarly.getTime() - GAME_DAY_LEAD_MS))).toBe(true)
    expect(isInGameDayWindow([sundayEarly], new Date(sundayEarly.getTime() - GAME_DAY_LEAD_MS - 60_000))).toBe(false)
    expect(isInGameDayWindow([mondayNight], new Date(mondayNight.getTime() + GAME_DAY_TAIL_MS))).toBe(true)
    expect(isInGameDayWindow([mondayNight], new Date(mondayNight.getTime() + GAME_DAY_TAIL_MS + 60_000))).toBe(false)
  })

  it('covers the end of a Monday night game, which finishes on a UTC Tuesday', () => {
    expect(isInGameDayWindow([mondayNight], new Date('2026-09-29T03:30:00Z'))).toBe(true)
  })

  it('is closed with no kickoff nearby, and ignores rows with no start time', () => {
    expect(isInGameDayWindow([], new Date('2026-09-30T16:00:00Z'))).toBe(false)
    expect(isInGameDayWindow([null, undefined], new Date('2026-09-30T16:00:00Z'))).toBe(false)
  })

  it('asks the schedule for an NFL kickoff inside the window', async () => {
    const now = new Date('2026-09-27T15:00:00Z')
    h.sportsGameFindFirst.mockResolvedValueOnce({ startTime: sundayEarly })
    await expect(isNflGameDayWindow(now)).resolves.toBe(true)

    const args = h.sportsGameFindFirst.mock.calls[0][0] as {
      where: { sport: { in: string[] }; startTime: { gte: Date; lte: Date } }
    }
    expect(args.where.sport.in).toContain('NFL')
    expect(args.where.startTime.gte.getTime()).toBe(now.getTime() - GAME_DAY_TAIL_MS)
    expect(args.where.startTime.lte.getTime()).toBe(now.getTime() + GAME_DAY_LEAD_MS)
  })

  it('answers "not a game day" when there is no game, or the read fails', async () => {
    h.sportsGameFindFirst.mockResolvedValueOnce(null)
    await expect(isNflGameDayWindow(new Date('2026-09-30T16:00:00Z'))).resolves.toBe(false)

    h.sportsGameFindFirst.mockRejectedValueOnce(new Error('db down'))
    await expect(isNflGameDayWindow(new Date('2026-09-27T15:00:00Z'))).resolves.toBe(false)
  })
})

function conn(i: number): LeagueSyncConnection {
  return { runKey: `sleeper:L${i}:2026:active`, provider: 'sleeper', externalLeagueId: `L${i}`, season: 2026, sport: 'NFL' }
}

describe('runDueLeagues start budget', () => {
  it('starts nothing new after the deadline and reports the rest as deferred, not done', async () => {
    let t = 0
    // Each league "takes" 10s of clock; the deadline is 25s, so leagues 0-2 start and 3-4 do not.
    h.sync.mockImplementation(async (connection: { runKey: string }) => {
      t += 10_000
      return {
        runKey: connection.runKey,
        executed: true,
        due: true,
        status: 'completed' as const,
        seasonState: 'regular_season' as const,
        cadenceMinutes: 5,
        nextEligibleAt: new Date().toISOString(),
      }
    })

    const summary = await runDueLeagues({
      connections: [0, 1, 2, 3, 4].map(conn),
      concurrency: 1,
      startDeadlineAt: 25_000,
      clock: () => t,
    })

    expect(h.sync).toHaveBeenCalledTimes(3)
    expect(summary.completed).toBe(3)
    expect(summary.executed).toBe(3)
    expect(summary.deferred).toBe(2)
    // Not folded into buckets that would read as "fresh" or "skipped for credentials".
    expect(summary.notDue).toBe(0)
    expect(summary.skipped).toBe(0)
    expect(summary.results.filter((r) => r.deferred).map((r) => r.runKey)).toEqual([
      'sleeper:L3:2026:active',
      'sleeper:L4:2026:active',
    ])
  })

  it('without a deadline runs every league, as before', async () => {
    const summary = await runDueLeagues({ connections: [0, 1, 2].map(conn), concurrency: 2 })
    expect(h.sync).toHaveBeenCalledTimes(3)
    expect(summary.deferred).toBe(0)
    expect(summary.completed).toBe(3)
  })
})
