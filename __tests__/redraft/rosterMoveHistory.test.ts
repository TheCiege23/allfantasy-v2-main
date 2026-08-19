/**
 * Phase 2H — recordRedraftRosterMoveHistory unit tests.
 * Mocks @/lib/prisma; no real database access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRosterMoveHistory: { create: createMock },
  },
}))

import { recordRedraftRosterMoveHistory, hashRosterSlotSnapshot } from '@/lib/redraft/rosterMoveHistory'

describe('recordRedraftRosterMoveHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes a row when before/after slot assignments differ', async () => {
    createMock.mockResolvedValue({ id: 'rmh-1' })

    const result = await recordRedraftRosterMoveHistory({
      leagueId: 'lg-1',
      rosterId: 'ros-1',
      seasonId: 'season-1',
      season: 2026,
      week: 5,
      actorUserId: 'user-1',
      source: 'user',
      beforeSlotAssignments: { 'p-1': 'BENCH', 'p-2': 'WR' },
      afterSlotAssignments: { 'p-1': 'WR', 'p-2': 'BENCH' },
    })

    expect(result).toEqual({ id: 'rmh-1', skipped: false })
    expect(createMock).toHaveBeenCalledTimes(1)
    const call = createMock.mock.calls[0][0]
    expect(call.data).toMatchObject({
      leagueId: 'lg-1',
      rosterId: 'ros-1',
      seasonId: 'season-1',
      season: 2026,
      week: 5,
      actorUserId: 'user-1',
      source: 'user',
      moveSummary: 'redraft_lineup_slot_update',
    })
    expect(call.data.beforeHash).not.toBe(call.data.afterHash)
  })

  it('skips (does not write) a genuine no-op save', async () => {
    const assignments = { 'p-1': 'WR', 'p-2': 'BENCH' }

    const result = await recordRedraftRosterMoveHistory({
      leagueId: 'lg-1',
      rosterId: 'ros-1',
      seasonId: 'season-1',
      season: 2026,
      week: 5,
      actorUserId: 'user-1',
      source: 'user',
      beforeSlotAssignments: assignments,
      afterSlotAssignments: { ...assignments }, // same content, different object identity
    })

    expect(result).toEqual({ id: null, skipped: true })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('is insensitive to key order (stable hashing)', async () => {
    const h1 = hashRosterSlotSnapshot({ a: 1, b: 2 })
    const h2 = hashRosterSlotSnapshot({ b: 2, a: 1 })
    expect(h1).toBe(h2)
  })

  it('passes through null actorUserId honestly (never fabricates an actor)', async () => {
    createMock.mockResolvedValue({ id: 'rmh-2' })
    await recordRedraftRosterMoveHistory({
      leagueId: 'lg-1',
      rosterId: 'ros-1',
      seasonId: 'season-1',
      season: 2026,
      week: 5,
      actorUserId: null,
      source: 'system',
      beforeSlotAssignments: { 'p-1': 'BENCH' },
      afterSlotAssignments: { 'p-1': 'WR' },
    })
    expect(createMock.mock.calls[0][0].data.actorUserId).toBeNull()
  })

  it('propagates a real Prisma failure to the caller (the route wraps this call, not this function)', async () => {
    createMock.mockRejectedValue(new Error('constraint violation'))
    await expect(
      recordRedraftRosterMoveHistory({
        leagueId: 'lg-1',
        rosterId: 'ros-1',
        seasonId: 'season-1',
        season: 2026,
        week: 5,
        actorUserId: 'user-1',
        source: 'user',
        beforeSlotAssignments: { 'p-1': 'BENCH' },
        afterSlotAssignments: { 'p-1': 'WR' },
      }),
    ).rejects.toThrow('constraint violation')
  })
})
