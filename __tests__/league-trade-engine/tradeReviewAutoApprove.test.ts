/** "Trades don't wait forever" (phase 13): the commissioner's opt-in 48-hour auto-approval. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => {
  const claims = new Set<string>()
  return {
    claims,
    trades: vi.fn(),
    flags: vi.fn(),
    status: vi.fn(),
    finalize: vi.fn(),
    log: vi.fn(async () => ({})),
    notify: vi.fn(async () => ({})),
    prisma: {
      afLeagueTrade: { findMany: vi.fn(), findUnique: vi.fn() },
      integrityFlag: { findMany: vi.fn() },
      sportsDataCache: {
        create: vi.fn(async ({ data }: { data: { cacheKey: string } }) => {
          if (claims.has(data.cacheKey)) throw Object.assign(new Error('unique'), { code: 'P2002' })
          claims.add(data.cacheKey)
          return data
        }),
        delete: vi.fn(async ({ where }: { where: { cacheKey: string } }) => {
          claims.delete(where.cacheKey)
          return {}
        }),
      },
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({ finalizeAfLeagueTradeProcessing: m.finalize }))

import { autoApproveDecision, tradeReviewAutoApproveOn } from '@/lib/league-trade-engine/tradeReviewAutoApprove'
import { runTradeReviewAutoApprovals, TRADE_AUTO_APPROVED_ACTION } from '@/lib/league-trade-engine/tradeReviewAutoApproveService'
import { automationToggleRequest } from '@/lib/commissioner-hub/automationToggles'

const NOW = new Date('2026-10-29T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)
const trade = (id: string, acceptedAt: Date) => ({ id, leagueId: 'L', acceptedAt, proposedByUserId: 'proposer', league: { userId: 'commish', name: 'Dynasty' } })

describe('autoApproveDecision', () => {
  it('waits a day, warns on the second, approves at 48 hours — and never approves a flagged trade', () => {
    expect(autoApproveDecision({ acceptedAt: hoursAgo(10), now: NOW, flagged: false })).toBe('wait')
    expect(autoApproveDecision({ acceptedAt: hoursAgo(30), now: NOW, flagged: false })).toBe('warn')
    expect(autoApproveDecision({ acceptedAt: hoursAgo(48), now: NOW, flagged: false })).toBe('approve')
    expect(autoApproveDecision({ acceptedAt: hoursAgo(500), now: NOW, flagged: true })).toBe('flagged')
    expect(autoApproveDecision({ acceptedAt: null, now: NOW, flagged: false })).toBe('wait')
  })

  it('is off unless the commissioner turned it on', () => {
    expect(tradeReviewAutoApproveOn({})).toBe(false)
    expect(tradeReviewAutoApproveOn({ trade_review_auto_approve: 'yes' })).toBe(false)
    expect(tradeReviewAutoApproveOn({ trade_review_auto_approve: true })).toBe(true)
    expect(automationToggleRequest('L', 'trade_review_auto_approve', true)).toEqual({ url: '/api/leagues/L/trade-review-auto-approve', method: 'POST', body: { on: true } })
  })
})

describe('runTradeReviewAutoApprovals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.claims.clear()
    m.prisma.afLeagueTrade.findMany.mockResolvedValue([trade('t-old', hoursAgo(50)), trade('t-day', hoursAgo(30)), trade('t-flagged', hoursAgo(80))])
    m.prisma.integrityFlag.findMany.mockResolvedValue([{ tradeTransactionId: 't-flagged' }])
    m.finalize.mockResolvedValue(undefined)
  })

  it('reads only leagues that opted in, approves the old unflagged trade, warns on the newer one, leaves the flagged one', async () => {
    const r = await runTradeReviewAutoApprovals({ now: NOW })
    expect(r).toMatchObject({ waiting: 3, approved: 1, warned: 1, flagged: 1, failures: [] })
    expect(m.prisma.afLeagueTrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'awaiting_commissioner', league: { settings: { path: ['trade_review_auto_approve'], equals: true } } }) }),
    )
    expect(m.finalize).toHaveBeenCalledTimes(1)
    expect(m.finalize).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 't-old', auditMetadata: expect.objectContaining({ automatic: true }) }))
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: TRADE_AUTO_APPROVED_ACTION, entityId: 't-old' }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'trade_review_auto_approve_soon', userIds: ['commish'], dedupePrefix: 'trade-auto-approve-warn:t-day' }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'trade_review_auto_approved', userIds: ['commish', 'proposer'] }))
  })

  it('approves a trade once, however many runs reach it', async () => {
    await runTradeReviewAutoApprovals({ now: NOW })
    await runTradeReviewAutoApprovals({ now: NOW })
    expect(m.finalize).toHaveBeenCalledTimes(1)
  })

  it('retries next hour when processing was refused before anything moved, never when the trade changed', async () => {
    m.prisma.afLeagueTrade.findMany.mockResolvedValue([trade('t-old', hoursAgo(50))])
    m.finalize.mockRejectedValueOnce(new Error('moves are frozen'))
    m.prisma.afLeagueTrade.findUnique.mockResolvedValueOnce({ status: 'awaiting_commissioner' })
    expect((await runTradeReviewAutoApprovals({ now: NOW })).failures).toHaveLength(1)
    expect(await runTradeReviewAutoApprovals({ now: NOW })).toMatchObject({ approved: 1 })

    m.claims.clear()
    m.finalize.mockReset()
    m.finalize.mockRejectedValueOnce(new Error('half way'))
    m.prisma.afLeagueTrade.findUnique.mockResolvedValueOnce({ status: 'scheduled' })
    await runTradeReviewAutoApprovals({ now: NOW })
    await runTradeReviewAutoApprovals({ now: NOW })
    expect(m.finalize).toHaveBeenCalledTimes(1)
  })
})
