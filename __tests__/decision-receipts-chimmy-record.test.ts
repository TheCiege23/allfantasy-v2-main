// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ snapshot: vi.fn() }))

vi.mock('server-only', () => ({}))
/* Every other kind of receipt fails to read here, so only the record decides what comes back. */
vi.mock('@/lib/prisma', () => {
  const fail = () => Promise.reject(new Error('down'))
  const table = new Proxy({}, { get: () => fail })
  return { prisma: new Proxy({}, { get: () => table }) }
})
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({ listAdviceForUser: () => Promise.reject(new Error('down')) }))
vi.mock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: h.snapshot }))

import { getDecisionReceipts } from '@/lib/core-app/decisionReceipts'
import { buildAdviceLearningSnapshot, type AdviceOutcome } from '@/lib/chimmy-outcomes/learningSnapshot'

/**
 * Chimmy's record on YOUR start/sit calls rides on the home Receipts card — the whole record from
 * the outcome snapshot, not just the handful of rows the card lists.
 */

const NOW = new Date('2026-09-24T12:00:00Z')
const call = (userId: string, i: number, result: 'right' | 'wrong' | 'same'): AdviceOutcome => ({
  userId,
  key: `${userId}:${i}`,
  adviceType: 'start_sit',
  confidencePct: null,
  givenAt: NOW,
  call: result,
  followed: 'unclear',
})
const ARGS = { userId: 'u1', leagues: [{ id: 'L1', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: '999' }], ownerSleeperId: null, currentWeek: 6 }

beforeEach(() => h.snapshot.mockReset())

describe('getDecisionReceipts + Chimmy record', () => {
  it('carries your record, rate included once earned', async () => {
    const outcomes = [
      ...Array.from({ length: 6 }, (_, i) => call('u1', i, 'right')),
      call('u1', 10, 'wrong'),
      call('u1', 11, 'same'),
      call('u2', 12, 'wrong'),
    ]
    h.snapshot.mockResolvedValue(buildAdviceLearningSnapshot(outcomes, { now: NOW, complete: true, users: 2 }))
    const out = await getDecisionReceipts(ARGS)
    expect(out?.chimmyRecord).toEqual({ right: 6, wrong: 1, same: 1, ratePct: 86 })
  })

  it('leaves it off when you have no graded calls — and returns nothing at all with nothing else to say', async () => {
    h.snapshot.mockResolvedValue(buildAdviceLearningSnapshot([call('u2', 1, 'right')], { now: NOW, complete: true, users: 1 }))
    expect(await getDecisionReceipts(ARGS)).toBeNull()
    h.snapshot.mockResolvedValue(null)
    expect(await getDecisionReceipts(ARGS)).toBeNull()
  })
})
