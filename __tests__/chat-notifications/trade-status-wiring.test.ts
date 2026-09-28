import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

/**
 * A trade offer card sits in the two managers' DM; every answer to it now posts a line under it
 * (and restamps the card). These pin the ROUTES' half: each answer path calls `queueTradeStatusInDm`
 * with the right source, trade id, status and actor, and a refused answer calls nothing.
 * `tradeOfferDm` itself is covered in its own suite.
 */

const h = vi.hoisted(() => ({
  userId: 'u-receiver' as string | null,
  status: vi.fn(),
  proposal: null as Record<string, unknown> | null,
  draftProposal: null as Record<string, unknown> | null,
  myRosterId: 'r-receiver',
  isCommish: false,
}))

vi.mock('next-auth', () => ({ getServerSession: async () => (h.userId ? { user: { id: h.userId } } : null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ queueTradeStatusInDm: h.status }))

// ── redraft trade-votes + dedicated veto route ──────────────────────────────────────────────────
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: async () => ({ ok: true, status: 200 }) }))
vi.mock('@/lib/idp/capEngine', () => ({
  validateRedraftTradeCap: vi.fn(async () => ({ ok: true })),
  validateRedraftTradeCapInTransaction: vi.fn(),
  applyRedraftTradeCapTransfersInTransaction: vi.fn(),
  refreshCapProjections: vi.fn(async () => undefined),
}))
vi.mock('@/lib/redraft/tradeSettlement', () => ({ settleRedraftTradeAssets: vi.fn() }))
vi.mock('@/lib/redraft/tradeExecutionSnapshot', () => ({
  captureRedraftRosterState: vi.fn(),
  writeRedraftTradeExecutionSnapshot: vi.fn(),
}))
vi.mock('@/lib/redraft/tradeReversal', () => ({
  evaluateNativeTradeReversalReadiness: vi.fn(),
  reverseNativeTrade: vi.fn(),
}))
vi.mock('@/lib/trade-reversal/notice', () => ({ publishTradeReversalNotice: vi.fn() }))
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_ACCEPTED: 'a', TRADE_PROCESSED: 'p' },
  getPlatformEvents: () => ({ emit: vi.fn(), emitInTx: vi.fn() }),
}))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({ enqueueCollusionScan: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai-learning-system/recordTradeParticipants', () => ({ recordTradeOutcomeForBothManagers: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: vi.fn(async () => 'NFL') }))

// ── draft-pick answer route ────────────────────────────────────────────────────────────────────
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: async () => true,
  getCurrentUserRosterIdForLeague: async () => h.myRosterId,
}))
vi.mock('@/lib/live-draft-engine/DraftPickTradeService', () => ({ appendDraftPickTrades: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: vi.fn(async () => ({ id: 'snap' })) }))
vi.mock('@/lib/commentary-engine', () => ({ onTradeReaction: vi.fn(async () => undefined) }))
vi.mock('@/lib/tournament-mode/safety', () => ({ isDraftPickTradingAllowedForLeague: async () => true }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: async () => ({ draftPickTradingEnabled: true, tradedPickColorModeEnabled: false }),
}))

vi.mock('@/lib/prisma', () => {
  const roster = (id: string, ownerId: string) => ({ id, ownerId })
  return {
    prisma: {
      redraftTradeProposal: {
        findFirst: async () => h.proposal,
        findUnique: async () => h.proposal,
        update: async ({ data }: { data: Record<string, unknown> }) => ({ ...h.proposal, ...data }),
        updateMany: async () => ({ count: 1 }),
      },
      redraftTradeDecision: {
        findFirst: async () => null,
        create: async () => ({}),
        update: async () => ({}),
      },
      redraftRoster: {
        findMany: async () => [roster('r-proposer', 'u-proposer'), roster('r-receiver', 'u-receiver')],
        findFirst: async () => ({ ownerId: 'u-proposer' }),
      },
      league: {
        findFirst: async () => ({ userId: h.isCommish ? h.userId : 'someone-else', teams: [] }),
        findUnique: async () => ({ userId: h.isCommish ? h.userId : 'someone-else', teams: [] }),
      },
      draftPickTradeProposal: {
        findFirst: async () => h.draftProposal,
        update: async () => ({}),
      },
      draftSession: { findUnique: async () => ({ id: 's1', tradedPicks: [], slotOrder: [] }) },
      leagueTeam: { findFirst: async () => ({ isCommissioner: true }), findMany: async () => [] },
    },
  }
})

function pendingRedraft(extra: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    leagueId: 'L1',
    seasonId: 's-1',
    status: 'pending',
    vetoMode: 'commissioner',
    acceptedAt: null,
    expiresAt: null,
    proposerRosterId: 'r-proposer',
    receiverRosterId: 'r-receiver',
    votes: [],
    assets: [],
    ...extra,
  }
}

async function vote(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/redraft/trade-votes/route')
  return POST(createMockNextRequest('http://localhost/api/redraft/trade-votes', { method: 'POST', body }) as never)
}

beforeEach(() => {
  h.status.mockReset()
  h.userId = 'u-receiver'
  h.isCommish = false
  h.proposal = pendingRedraft()
  h.myRosterId = 'r-receiver'
  h.draftProposal = {
    id: 'dp-1',
    status: 'pending',
    proposerRosterId: 'r-proposer',
    receiverRosterId: 'r-receiver',
    proposerName: 'A',
    receiverName: 'B',
    giveRound: 2,
    giveSlot: 3,
    receiveRound: 3,
    receiveSlot: 4,
    session: { leagueId: 'L1', slotOrder: [] },
  }
})

describe('redraft trade center — every answer posts under the offer card', () => {
  it('the receiver declines → "rejected", naming them', async () => {
    expect((await vote({ proposalId: 'p-1', action: 'reject' })).status).toBe(200)
    expect(h.status).toHaveBeenCalledTimes(1)
    expect(h.status).toHaveBeenCalledWith({ source: 'redraft', tradeId: 'p-1', status: 'rejected', actorUserId: 'u-receiver' })
  })

  it('the proposer pulls it → "cancelled", naming them', async () => {
    h.userId = 'u-proposer'
    expect((await vote({ proposalId: 'p-1', action: 'cancel' })).status).toBe(200)
    expect(h.status).toHaveBeenCalledWith({ source: 'redraft', tradeId: 'p-1', status: 'cancelled', actorUserId: 'u-proposer' })
  })

  it('the receiver accepts in a league with review → "accepted", saying what it waits on', async () => {
    const res = await vote({ proposalId: 'p-1', action: 'accept' })
    expect(res.status).toBe(200)
    expect(h.status).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'redraft',
        tradeId: 'p-1',
        status: 'accepted',
        actorUserId: 'u-receiver',
        detail: 'It goes to commissioner review before it processes.',
      }),
    )

    h.status.mockReset()
    h.proposal = pendingRedraft({ vetoMode: 'league_vote' })
    await vote({ proposalId: 'p-1', action: 'accept' })
    expect(h.status).toHaveBeenCalledWith(expect.objectContaining({ detail: 'It goes to a league vote before it processes.' }))
  })

  it('an offer that ran out of time → "expired"', async () => {
    h.proposal = pendingRedraft({ expiresAt: new Date(Date.now() - 60_000) })
    await vote({ proposalId: 'p-1', action: 'reject' })
    expect(h.status).toHaveBeenCalledWith({ source: 'redraft', tradeId: 'p-1', status: 'expired' })
  })

  it('a commissioner veto (both routes) → "vetoed", saying the commissioner made the call', async () => {
    h.userId = 'u-commish'
    h.isCommish = true
    await vote({ proposalId: 'p-1', action: 'commissioner_veto' })
    expect(h.status).toHaveBeenCalledWith({
      source: 'redraft',
      tradeId: 'p-1',
      status: 'vetoed',
      detail: 'The commissioner made the call.',
    })

    h.status.mockReset()
    const { POST } = await import('@/app/api/redraft/trades/veto/route')
    const res = await POST(
      createMockNextRequest('http://localhost/api/redraft/trades/veto', { method: 'POST', body: { proposalId: 'p-1' } }) as never,
    )
    expect(res.status).toBe(200)
    expect(h.status).toHaveBeenCalledWith({
      source: 'redraft',
      tradeId: 'p-1',
      status: 'vetoed',
      detail: 'The commissioner made the call.',
    })
  })

  it('a refused answer posts nothing', async () => {
    h.userId = 'u-stranger'
    expect((await vote({ proposalId: 'p-1', action: 'reject' })).status).toBe(403)
    h.userId = null
    expect((await vote({ proposalId: 'p-1', action: 'reject' })).status).toBe(401)
    expect(h.status).not.toHaveBeenCalled()
  })
})

describe('draft-pick trades — every answer posts under the offer card', () => {
  const ctx = { params: Promise.resolve({ leagueId: 'L1', proposalId: 'dp-1' }) }
  async function respond(action: string) {
    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/trade-proposals/[proposalId]/route')
    return POST(createMockNextRequest('http://localhost/x', { method: 'POST', body: { action } }) as never, ctx as never)
  }

  it('declined → "rejected"; withdrawn → "cancelled"', async () => {
    expect((await respond('reject')).status).toBe(200)
    expect(h.status).toHaveBeenCalledWith({ source: 'draft_pick', tradeId: 'dp-1', status: 'rejected', actorUserId: 'u-receiver' })

    h.status.mockReset()
    h.userId = 'u-proposer'
    h.myRosterId = 'r-proposer'
    const { DELETE } = await import('@/app/api/leagues/[leagueId]/draft/trade-proposals/[proposalId]/route')
    expect((await DELETE(createMockNextRequest('http://localhost/x', { method: 'DELETE' }) as never, ctx as never)).status).toBe(200)
    expect(h.status).toHaveBeenCalledWith({ source: 'draft_pick', tradeId: 'dp-1', status: 'cancelled', actorUserId: 'u-proposer' })
  })

  it('a counter posts nothing: the draft room stores it as a flag, with no new offer to point "below" at', async () => {
    expect((await respond('counter')).status).toBe(200)
    expect(h.status).not.toHaveBeenCalled()
  })

  it('someone who is not the receiver posts nothing', async () => {
    h.myRosterId = 'r-other'
    expect((await respond('reject')).status).toBe(403)
    expect(h.status).not.toHaveBeenCalled()
  })
})
