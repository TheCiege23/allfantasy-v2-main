/**
 * Sealing a week in a daily-lineup league: the starters to cover are everyone who started on ANY day,
 * not whoever holds a starter slot when the finalizer runs.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { finalizeRedraftWeek } from '@/lib/redraft/weekFinalizer'

type AnyArgs = Record<string, any>

/** NHL week 1 runs 2026-09-29 → 2026-10-06. */
const AFTER_GRACE = new Date('2026-10-06T12:00:00.000Z')
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function makePrisma(daily: boolean) {
  const players = [
    { rosterId: 'r1', playerId: 'p1', position: 'C', sport: 'NHL', slotType: 'C', addedAt: null, droppedAt: null },
    // On the bench now, but he started on the Tuesday.
    { rosterId: 'r1', playerId: 'p2', position: 'LW', sport: 'NHL', slotType: 'bench', addedAt: null, droppedAt: null },
  ]
  return {
    league: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => ({
        sport: 'NHL',
        settings: daily ? { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } } : {},
      })),
    },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', leagueId: 'L1', sport: 'NHL', season: 2026 })) },
    redraftMatchup: { findMany: vi.fn(async () => [{ id: 'm1', status: 'active', awayRosterId: 'r2' }]) },
    sportsGame: {
      findMany: vi.fn(async () => [
        { status: 'final', startTime: new Date('2026-10-05T23:00:00.000Z'), source: 'thesportsdb', fetchedAt: new Date('2026-10-06T06:00:00Z'), season: 2026, week: 1 },
      ]),
    },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'r1' }]) },
    roster: { findMany: vi.fn(async () => []) },
    afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
    redraftRosterPlayer: { findMany: vi.fn(async () => players) },
    redraftDailyLineup: {
      findMany: vi.fn(async () => [
        { rosterId: 'r1', scoringDay: day('2026-09-29'), playerId: 'p1', slotType: 'C' },
        { rosterId: 'r1', scoringDay: day('2026-09-29'), playerId: 'p2', slotType: 'LW' },
        { rosterId: 'r1', scoringDay: day('2026-09-30'), playerId: 'p1', slotType: 'C' },
        { rosterId: 'r1', scoringDay: day('2026-09-30'), playerId: 'p2', slotType: 'bench' },
      ]),
    },
    playerWeeklyScore: {
      findMany: vi.fn(async (args: AnyArgs) => (args.where.playerId.in as string[]).map((playerId) => ({ playerId, sport: 'NHL' }))),
      createMany: vi.fn(async (args: AnyArgs) => ({ count: args.data.length })),
      updateMany: vi.fn(async () => ({ count: 2 })),
    },
    playerDailyScore: { updateMany: vi.fn(async () => ({ count: 3 })) },
  } as any
}

describe('finalizeRedraftWeek in a daily-lineup league', () => {
  it('covers and seals every player who started on any day, and seals their daily rows', async () => {
    const prisma = makePrisma(true)
    const result = await finalizeRedraftWeek(
      { seasonId: 's1', week: 1 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn(async () => undefined) as any, notifyResults: vi.fn(async () => undefined) },
    )
    expect(result.refusal).toBeNull()
    expect(result.starters).toBe(2)
    const sealed = prisma.playerWeeklyScore.updateMany.mock.calls[0][0].where.playerId.in
    expect([...sealed].sort()).toEqual(['p1', 'p2'])
    expect(prisma.playerDailyScore.updateMany).toHaveBeenCalledWith({
      where: { season: 2026, sport: 'NHL', playerId: { in: expect.arrayContaining(['p1', 'p2']) }, week: 1, isFinalized: false },
      data: { isFinalized: true },
    })
  })

  it('a weekly league keeps covering only the current starters and never touches daily rows', async () => {
    const prisma = makePrisma(false)
    const result = await finalizeRedraftWeek(
      { seasonId: 's1', week: 1 },
      { prisma, now: () => AFTER_GRACE, recalculateMatchups: vi.fn(async () => undefined) as any, notifyResults: vi.fn(async () => undefined) },
    )
    expect(result.starters).toBe(1)
    expect(prisma.redraftDailyLineup.findMany).not.toHaveBeenCalled()
    expect(prisma.playerDailyScore.updateMany).not.toHaveBeenCalled()
  })
})
