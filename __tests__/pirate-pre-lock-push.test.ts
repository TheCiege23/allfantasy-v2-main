import type { PrismaClient } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pushRetentionSeconds } from '@/lib/notifications/gameAlertFreshness'
import { queuePiratePreLockPush, refreshPiratePreLockPush } from '@/lib/pirate/preLockPush'

const mocks = vi.hoisted(() => ({ advice: vi.fn(), gate: vi.fn(), state: vi.fn() }))
vi.mock('@/lib/pirate/preLockAdvice', () => ({ readPiratePreLockAdvice: mocks.advice }))
vi.mock('@/lib/notifications/pushGate', () => ({ decidePushForUser: mocks.gate }))
vi.mock('@/lib/pirate/service', () => ({ pirateWeekState: mocks.state }))

const createMany = vi.fn()
const db = {
  redraftRoster: { findMany: vi.fn().mockResolvedValue([{ id: 'roster', ownerId: 'manager' }]) },
  notificationOutbox: { createMany },
} as unknown as PrismaClient

function advice(minutes = 60) {
  return {
    scoringDay: '2026-11-03', deadlineAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    issues: ['QB: Jordan Love is out'], moves: [{ playerId: 'backup' }],
  }
}

describe('Pirate pre-lock push', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.mockResolvedValue({ season: { id: 'season', season: 2026 }, week: 9 })
    mocks.gate.mockResolvedValue({ allowed: true })
    mocks.advice.mockResolvedValue(advice())
  })

  it('queues one deduplicated, named lineup alert with a direct link and early expiry', async () => {
    await queuePiratePreLockPush('league', db)
    await queuePiratePreLockPush('league', db)
    const write = createMany.mock.calls[0][0]
    const [row] = write.data
    expect(write).toEqual(createMany.mock.calls[1][0])
    expect(write.skipDuplicates).toBe(true)
    expect(row).toMatchObject({ userId: 'manager', channel: 'push', metadata: { actionHref: '/league/league?view=roster' } })
    expect(row.body).toContain('QB: Jordan Love is out')
    expect(Date.parse(row.metadata.expiresAt)).toBe(Date.parse((await mocks.advice()).deadlineAt) - 900_000)
    expect(pushRetentionSeconds(row.eventType)).toBe(0)
  })

  it('skips managers who have not opted in', async () => {
    mocks.gate.mockResolvedValue({ allowed: false })
    await queuePiratePreLockPush('league', db)
    expect(mocks.advice).not.toHaveBeenCalled()
    expect(createMany).not.toHaveBeenCalled()
  })

  it.each([10, 130])('skips a warning %i minutes before lock', async (minutes) => {
    mocks.advice.mockResolvedValue(advice(minutes))
    await queuePiratePreLockPush('league', db)
    expect(createMany).not.toHaveBeenCalled()
  })

  it('refreshes the issue at delivery and drops alerts when a legal move disappears', async () => {
    await queuePiratePreLockPush('league', db)
    const metadata = createMany.mock.calls[0][0].data[0].metadata
    mocks.advice.mockResolvedValue({ ...advice(), issues: ['QB slot is empty'] })
    await expect(refreshPiratePreLockPush('league', 'manager', metadata, db)).resolves.toMatchObject({ body: expect.stringContaining('QB slot is empty') })
    mocks.advice.mockResolvedValue({ ...advice(), moves: [] })
    await expect(refreshPiratePreLockPush('league', 'manager', metadata, db)).resolves.toBeNull()
    mocks.advice.mockResolvedValue(advice(5))
    await expect(refreshPiratePreLockPush('league', 'manager', metadata, db)).resolves.toBeNull()
  })
})
