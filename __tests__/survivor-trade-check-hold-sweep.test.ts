// @vitest-environment node
/**
 * The redraft review-window sweep leaves Survivor trades held because the trade-rule check could not
 * run (lib/survivor/survivorTradeCheckHold.ts) for the commissioner, exactly like integrity-held ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: { redraftTradeProposal: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }, redraftRoster: { findMany: vi.fn() } },
  integrityHeld: vi.fn(),
  survivorHeld: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/redraft/tradeMoveLock', () => ({ isRedraftLeagueMovesLocked: async () => false }))
vi.mock('@/lib/redraft/finalizeRedraftTrade', () => ({ finalizeRedraftTrade: vi.fn(), upsertRedraftTradeDecision: vi.fn() }))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: vi.fn() }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: vi.fn() }))
vi.mock('@/lib/integrity/holdFlaggedTrades', () => ({ heldTradeIds: h.integrityHeld }))
vi.mock('@/lib/survivor/survivorTradeCheckHold', () => ({ survivorHeldRedraftProposalIds: h.survivorHeld }))
vi.mock('@/lib/redraft/multiTeamTradeNotices', () => ({ MULTI_TEAM_TRADE_CLOSED_TITLE: 'x', notifyMultiTeamTradeParties: vi.fn() }))

import { processDueTradeReviews } from '@/lib/redraft/tradeReviewWindowSweep'

beforeEach(() => {
  vi.clearAllMocks()
  h.db.redraftTradeProposal.count.mockResolvedValue(2)
  h.db.redraftTradeProposal.findMany.mockResolvedValue([])
})

describe('review-window sweep and the Survivor hold', () => {
  it('leaves both kinds of held trade out of the batch', async () => {
    h.integrityHeld.mockResolvedValue(['flagged'])
    h.survivorHeld.mockResolvedValue(['survivor-held', 'flagged'])
    const result = await processDueTradeReviews({ now: new Date('2026-11-10T12:00:00Z') })
    const where = h.db.redraftTradeProposal.findMany.mock.calls[0][0].where
    expect(where.id).toEqual({ notIn: ['flagged', 'survivor-held'] })
    expect(result.held).toBe(2)
  })

  it('with nothing held, the query is unchanged', async () => {
    h.integrityHeld.mockResolvedValue([])
    h.survivorHeld.mockResolvedValue([])
    await processDueTradeReviews({ now: new Date('2026-11-10T12:00:00Z') })
    expect(h.db.redraftTradeProposal.findMany.mock.calls[0][0].where.id).toBeUndefined()
  })
})
