// @vitest-environment node
/**
 * "Suspicious trade alerts": the commissioner is notified when the collusion check flags a trade,
 * unless they switched it off (League.settings.integrity_trade_alerts). Tanking flags are unaffected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ flag: vi.fn(), update: vi.fn(), add: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { integrityFlag: { findFirst: h.flag, update: h.update } } }))
vi.mock('@/lib/queues/bullmq', () => ({ getNotificationsQueue: () => ({ add: h.add }) }))

import { notifyCommissionerOfFlag } from '@/lib/integrity/integrityNotifier'
import { readTradeAlertsEnabled } from '@/lib/integrity/tradeAlerts'

const flag = (flagType: string, settings: unknown) => ({
  id: 'F', leagueId: 'L', flagType, severity: 'high', summary: 'Lopsided trade', notifiedAt: null, league: { userId: 'owner', settings },
})

beforeEach(() => vi.clearAllMocks())

describe('suspicious trade alerts', () => {
  it('on by default: every league before the switch existed keeps getting alerts', () => {
    expect(readTradeAlertsEnabled(null)).toBe(true)
    expect(readTradeAlertsEnabled({})).toBe(true)
    expect(readTradeAlertsEnabled({ integrity_trade_alerts: false })).toBe(false)
  })

  it('a flagged trade alerts the commissioner and is marked sent', async () => {
    h.flag.mockResolvedValue(flag('collusion', {}))
    await notifyCommissionerOfFlag('F')
    expect(h.add).toHaveBeenCalledWith('integrity_flag', expect.objectContaining({ userIds: ['owner'], type: 'integrity_collusion_flag' }), expect.anything())
    expect(h.update).toHaveBeenCalled()
  })

  it('switched off: no alert, and the flag is left for the review page', async () => {
    h.flag.mockResolvedValue(flag('collusion', { integrity_trade_alerts: false }))
    await notifyCommissionerOfFlag('F')
    expect(h.add).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })

  it('the switch is about trades: tanking alerts still go out', async () => {
    h.flag.mockResolvedValue(flag('tanking', { integrity_trade_alerts: false }))
    await notifyCommissionerOfFlag('F')
    expect(h.add).toHaveBeenCalledWith('integrity_flag', expect.objectContaining({ type: 'integrity_tanking_flag' }), expect.anything())
  })
})
