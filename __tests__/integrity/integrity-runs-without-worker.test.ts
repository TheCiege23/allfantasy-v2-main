/**
 * Integrity scans and alerts run in-process. Production has no BullMQ worker, so anything that only
 * reached the queue never ran (lib/integrity/runIntegrityJob.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  automationLock: { create: vi.fn(), delete: vi.fn() },
  integrityFlag: { findFirst: vi.fn(), update: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const entitlement = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@/lib/integrity/leagueEntitlement', () => ({ checkLeagueCommissionerEntitlement: entitlement.check }))

const engines = vi.hoisted(() => ({ trade: vi.fn(), league: vi.fn(), week: vi.fn() }))
vi.mock('@/lib/integrity/CollusionDetectionEngine', () => ({
  scanTradeForCollusion: engines.trade,
  fullLeagueCollusionScan: engines.league,
}))
vi.mock('@/lib/integrity/TankingDetectionEngine', () => ({ scanWeekForTanking: engines.week }))

const dispatch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))

const queues = vi.hoisted(() => ({ add: vi.fn() }))
vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({ add: queues.add, close: vi.fn() })),
  Worker: vi.fn(),
}))

import { enqueueCollusionScan } from '@/lib/integrity/enqueueCollusionScan'
import { enqueueTankingScan, tankingScanMarkerKey } from '@/lib/integrity/enqueueTankingScan'
import { notifyCommissionerOfFlag } from '@/lib/integrity/integrityNotifier'

const p2002 = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' })

beforeEach(() => {
  vi.clearAllMocks()
  entitlement.check.mockResolvedValue(true)
  engines.trade.mockResolvedValue(undefined)
  engines.week.mockResolvedValue(undefined)
  db.automationLock.create.mockResolvedValue({})
  db.automationLock.delete.mockResolvedValue({})
  db.integrityFlag.update.mockResolvedValue({})
  dispatch.mockResolvedValue({})
})

describe('collusion scan', () => {
  it('scans the settled trade directly, never through the queue', async () => {
    await enqueueCollusionScan('L1', { kind: 'af', tradeId: 'T1' }, ['r1', 'r2'])
    expect(engines.trade).toHaveBeenCalledWith('L1', 'T1', { kind: 'af', tradeId: 'T1' })
    expect(queues.add).not.toHaveBeenCalled()
  })

  it('keys a redraft trade on its proposal id', async () => {
    await enqueueCollusionScan('L1', { kind: 'redraft', proposalId: 'P9' }, [])
    expect(engines.trade).toHaveBeenCalledWith('L1', 'P9', { kind: 'redraft', proposalId: 'P9' })
  })

  it('skips a league without AF Commissioner', async () => {
    entitlement.check.mockResolvedValue(false)
    await enqueueCollusionScan('L1', { kind: 'af', tradeId: 'T1' }, [])
    expect(engines.trade).not.toHaveBeenCalled()
  })
})

describe('tanking scan', () => {
  it('claims the week marker, then scans', async () => {
    await enqueueTankingScan('L1', 3, 'S1')
    expect(db.automationLock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lockKey: tankingScanMarkerKey('L1', 'S1', 3) }),
    })
    expect(engines.week).toHaveBeenCalledWith('L1', 3, 'S1')
    expect(queues.add).not.toHaveBeenCalled()
  })

  it('does not scan a week again when the finalizer re-runs it', async () => {
    db.automationLock.create.mockRejectedValue(p2002())
    await enqueueTankingScan('L1', 3, 'S1')
    expect(engines.week).not.toHaveBeenCalled()
  })

  it('releases the marker when the scan fails, so the next run retries', async () => {
    engines.week.mockRejectedValue(new Error('boom'))
    await expect(enqueueTankingScan('L1', 3, 'S1')).rejects.toThrow('boom')
    expect(db.automationLock.delete).toHaveBeenCalledWith({ where: { lockKey: tankingScanMarkerKey('L1', 'S1', 3) } })
  })

  it('keeps the marker for a league without AF Commissioner', async () => {
    entitlement.check.mockResolvedValue(false)
    await enqueueTankingScan('L1', 3, 'S1')
    expect(engines.week).not.toHaveBeenCalled()
    expect(db.automationLock.delete).not.toHaveBeenCalled()
  })
})

describe('integrity alert', () => {
  const flag = (over: Record<string, unknown> = {}) => ({
    id: 'F1',
    leagueId: 'L1',
    flagType: 'collusion',
    severity: 'high',
    summary: 'Lopsided trade',
    notifiedAt: null,
    league: { userId: 'U1', settings: {} },
    ...over,
  })

  it('dispatches to the commissioner directly and marks the flag notified', async () => {
    db.integrityFlag.findFirst.mockResolvedValue(flag())
    await notifyCommissionerOfFlag('F1')
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['U1'],
        category: 'commissioner_alerts',
        type: 'integrity_collusion_flag',
        // The alert opens the flag itself, which the page scrolls to and highlights.
        actionHref: '/league/L1/commissioner/integrity?flag=F1',
      }),
    )
    expect(queues.add).not.toHaveBeenCalled()
    expect(db.integrityFlag.update).toHaveBeenCalledWith({ where: { id: 'F1' }, data: { notifiedAt: expect.any(Date) } })
  })

  it('does not mark a flag notified when the send failed', async () => {
    db.integrityFlag.findFirst.mockResolvedValue(flag())
    dispatch.mockRejectedValue(new Error('down'))
    await notifyCommissionerOfFlag('F1')
    expect(db.integrityFlag.update).not.toHaveBeenCalled()
  })

  it('stays quiet on a collusion flag when trade alerts are off', async () => {
    db.integrityFlag.findFirst.mockResolvedValue(flag({ league: { userId: 'U1', settings: { integrity_trade_alerts: false } } }))
    await notifyCommissionerOfFlag('F1')
    expect(dispatch).not.toHaveBeenCalled()
  })
})
