import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    redraftTradeProposal: { findMany: vi.fn(), updateMany: vi.fn() },
    redraftRoster: { findMany: vi.fn() },
  },
  locked: vi.fn(async () => false),
  finalize: vi.fn(),
  decision: vi.fn(async () => ({})),
  market: vi.fn(async () => ({})),
  dm: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/redraft/tradeMoveLock', () => ({ isRedraftLeagueMovesLocked: m.locked }))
vi.mock('@/lib/redraft/finalizeRedraftTrade', () => ({ finalizeRedraftTrade: m.finalize, upsertRedraftTradeDecision: m.decision }))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: m.market }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: m.dm }))

import { processDueTradeReviews, REVIEW_WINDOW_DECISION_REASON } from '@/lib/redraft/tradeReviewWindowSweep'

const NOW = new Date('2026-10-25T12:00:00Z')
const due = (id: string, leagueId = 'L') => ({
  id, leagueId, seasonId: 'S', proposerRosterId: 'rp', receiverRosterId: 'rr', status: 'pending', vetoMode: 'league_vote',
  vetoThreshold: 4, acceptedAt: new Date('2026-10-23T12:00:00Z'), expiresAt: new Date('2026-10-25T11:00:00Z'), assets: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  m.locked.mockResolvedValue(false)
  m.prisma.redraftRoster.findMany.mockResolvedValue([{ id: 'rp', ownerId: 'u-p' }, { id: 'rr', ownerId: 'u-r' }])
  m.prisma.redraftTradeProposal.updateMany.mockResolvedValue({ count: 1 })
  m.finalize.mockResolvedValue({ ok: true, proposal: {} })
})

describe('processDueTradeReviews', () => {
  it('asks only for accepted, still-pending reviews whose window has passed', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([])
    await processDueTradeReviews({ now: NOW })
    expect(m.prisma.redraftTradeProposal.findMany.mock.calls[0][0].where).toEqual({
      status: 'pending', acceptedAt: { not: null }, expiresAt: { lt: NOW }, vetoMode: { in: ['commissioner', 'league_vote'] },
    })
  })

  it('puts an unvetoed trade through the shared finalizer, as the review window, with no person as decider', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([due('p1')])
    expect(await processDueTradeReviews({ now: NOW })).toMatchObject({ due: 1, processed: 1, closed: 0 })
    expect(m.finalize).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), 'u-p', 'u-r', null, REVIEW_WINDOW_DECISION_REASON, 'proposal_accepted', 'review_window')
  })

  it('waits while moves are locked, checking the lock once per league', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([due('p1'), due('p2'), due('p3', 'L2')])
    m.locked.mockImplementation(async (leagueId: string) => leagueId === 'L')
    expect(await processDueTradeReviews({ now: NOW })).toMatchObject({ waitingOnLock: 2, processed: 1 })
    expect(m.locked).toHaveBeenCalledTimes(2)
    expect(m.prisma.redraftTradeProposal.updateMany).not.toHaveBeenCalled()
  })

  it('leaves a trade someone else just settled', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([due('p1')])
    m.finalize.mockResolvedValue({ ok: false, status: 409, error: 'Proposal already resolved', alreadyResolved: true })
    expect(await processDueTradeReviews({ now: NOW })).toMatchObject({ skipped: 1, closed: 0 })
    expect(m.prisma.redraftTradeProposal.updateMany).not.toHaveBeenCalled()
  })

  it('closes a trade that can no longer settle, with the reason, instead of retrying it every hour', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([due('p1')])
    m.finalize.mockResolvedValue({ ok: false, status: 409, error: 'Player is no longer on the roster' })
    expect(await processDueTradeReviews({ now: NOW })).toMatchObject({ closed: 1, processed: 0 })
    expect(m.prisma.redraftTradeProposal.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', status: 'pending' }, data: { status: 'expired', processedAt: NOW } })
    const reason = 'Could not be processed when the review window ended: Player is no longer on the roster'
    expect(m.decision).toHaveBeenCalledWith('p1', 'expired', null, reason)
    expect(m.dm).toHaveBeenCalledWith({ source: 'redraft', tradeId: 'p1', status: 'expired', detail: reason })
  })

  it('does not close one that was decided between the refusal and the close', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([due('p1')])
    m.finalize.mockResolvedValue({ ok: false, status: 409, error: 'cap' })
    m.prisma.redraftTradeProposal.updateMany.mockResolvedValue({ count: 0 })
    expect(await processDueTradeReviews({ now: NOW })).toMatchObject({ skipped: 1, closed: 0 })
    expect(m.decision).not.toHaveBeenCalled()
  })

  it('records a throw and carries on with the rest', async () => {
    m.prisma.redraftTradeProposal.findMany.mockResolvedValue([due('p1'), due('p2')])
    m.finalize.mockRejectedValueOnce(new Error('db down'))
    expect(await processDueTradeReviews({ now: NOW })).toMatchObject({ processed: 1, failures: [{ proposalId: 'p1', error: 'db down' }] })
  })
})
