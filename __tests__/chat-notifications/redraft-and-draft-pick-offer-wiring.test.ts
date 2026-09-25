/**
 * 🛑 The redraft trade center never told the RECEIVER about an offer. Now it does (trade_proposals,
 * the same category the native engine uses), and both the redraft center and the live-draft pick
 * trade post the offer card into the two managers' DM.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  dispatch: vi.fn(),
  postOffer: vi.fn(),
  loadRedraft: vi.fn(),
  loadDraftPick: vi.fn(),
  prisma: {
    redraftSeason: { findFirst: vi.fn(), findUnique: vi.fn(async () => null) },
    redraftRoster: { findFirst: vi.fn(), count: vi.fn(async () => 2) },
    redraftTradeValueSnapshot: { findUnique: vi.fn(async () => null), create: vi.fn() },
    redraftLeagueExtendedSettings: { findUnique: vi.fn(async () => null) },
    adpDataRecord: { findMany: vi.fn(async () => []) },
    userProfile: { findUnique: vi.fn(async () => null) },
    league: { findFirst: vi.fn(), findUnique: vi.fn(async () => ({ name: 'Pirate League' })) },
    draftPickTradeProposal: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true, status: 200 })) }))
vi.mock('@/lib/redraft/tradeProposalValidation', () => ({
  validateRedraftTradeProposalAtCreation: vi.fn(async () => ({ ok: true, warnings: [] })),
}))
vi.mock('@/lib/trade-value/captureSnapshot', () => ({ captureRedraftTradeValueSnapshot: vi.fn(async () => null) }))
vi.mock('@/lib/trade-market/redraftTradeMarketEvents', () => ({ recordRedraftTradeMarketEvent: vi.fn(async () => null) }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn(async () => null) }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: vi.fn(async () => 'NFL') }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ postTradeOfferToDm: h.postOffer }))
vi.mock('@/lib/chat-notifications/tradeOfferSources', () => ({
  loadRedraftTradeOffer: h.loadRedraft,
  loadDraftPickTradeOffer: h.loadDraftPick,
}))
// Draft-pick route collaborators.
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => 'rA'),
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  getDraftSessionByLeague: vi.fn(async () => ({
    id: 'sess-1',
    status: 'in_progress',
    rounds: 5,
    teamCount: 2,
    draftType: 'snake',
    thirdRoundReversal: false,
    slotOrder: [
      { slot: 1, rosterId: 'rA', displayName: 'Dana' },
      { slot: 2, rosterId: 'rB', displayName: 'Bob' },
    ],
    tradedPicks: [],
    picks: [],
  })),
}))
vi.mock('@/lib/tournament-mode/safety', () => ({ isDraftPickTradingAllowedForLeague: vi.fn(async () => true) }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: vi.fn(async () => ({ pickTradeEnabled: true })) }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => false) }))
vi.mock('@/lib/commissioner-ai-draft-manager', () => ({
  canAiProposeTrade: () => ({ allowed: true }),
  checkAiProposalRoundCap: () => ({ ok: true }),
  isRosterAiControlled: () => false,
  maybeAutoRespondToTradeProposal: vi.fn(),
  parseCommissionerAiManagers: () => ({}),
  withUpdatedProposalThrottle: vi.fn(),
  saveCommissionerAiManagers: vi.fn(),
}))
vi.mock('@/lib/draft-notifications', () => ({
  createDraftNotification: vi.fn(async () => null),
  getAppUserIdForRoster: vi.fn(async () => 'uB'),
  notifyDraftAiTradeReviewAvailable: vi.fn(async () => null),
}))
vi.mock('@/lib/trade-ai-dm/TradeAIDMService', () => ({
  sendPrivateTradeAIDM: vi.fn(async () => ({ sent: true, threadId: 'ai-1', counterSuggestion: 'ask for more' })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'uA' } })
  h.dispatch.mockResolvedValue(undefined)
  h.postOffer.mockResolvedValue({ posted: true })
  h.prisma.redraftSeason.findFirst.mockResolvedValue({ id: 's-1', leagueId: 'l-1', sport: 'NFL', season: 2026 })
  h.prisma.redraftRoster.findFirst
    .mockResolvedValueOnce({ id: 'r-1', ownerId: 'uA', ownerName: 'dana@example.org', teamName: 'Dana Dynasty' })
    .mockResolvedValueOnce({ id: 'r-2', ownerId: 'uB', ownerName: 'Bob', teamName: null })
  h.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({
      redraftTradeProposal: {
        create: vi.fn(async () => ({ id: 'p-1' })),
        findUnique: vi.fn(async () => ({ id: 'p-1', status: 'pending', assets: [], votes: [], decision: null })),
      },
      redraftTradeAsset: { createMany: vi.fn(async () => ({ count: 1 })) },
    }),
  )
})

async function proposeRedraft() {
  const { POST } = await import('@/app/api/redraft/trade-proposals/route')
  return POST(
    createMockNextRequest('http://localhost/api/redraft/trade-proposals', {
      method: 'POST',
      body: {
        leagueId: 'l-1',
        seasonId: 's-1',
        proposerRosterId: 'r-1',
        receiverRosterId: 'r-2',
        reason: 'You need a QB',
        assets: [{ fromRosterId: 'r-1', toRosterId: 'r-2', assetType: 'future_consideration' }],
      },
    }) as never,
  )
}

describe('redraft trade center', () => {
  it('🛑 the receiver is notified — trade_proposals, addressed to them, never the proposer', async () => {
    const res = await proposeRedraft()
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledTimes(1))
    const call = h.dispatch.mock.calls[0][0]
    expect(call).toMatchObject({
      userIds: ['uB'],
      category: 'trade_proposals',
      type: 'trade_proposed',
      actionHref: '/league/l-1?view=trades',
      leagueId: 'l-1',
      dedupePrefix: 'redraft_trade:p-1:proposed',
    })
    // The proposer's owner name is an address here: the team name is used.
    expect(call.body).toBe('Dana Dynasty sent you a trade offer. Open it to accept, counter, or decline.')
  })

  it('the offer card goes into the two managers’ DM', async () => {
    await proposeRedraft()
    await vi.waitFor(() => expect(h.postOffer).toHaveBeenCalledTimes(1))
    const call = h.postOffer.mock.calls[0][0] as { source: string; tradeId: string; load: () => unknown }
    expect(call).toMatchObject({ source: 'redraft', tradeId: 'p-1' })
    await call.load()
    expect(h.loadRedraft).toHaveBeenCalledWith('p-1')
  })

  it('🛑 a notification or DM failure never fails the proposal', async () => {
    h.dispatch.mockRejectedValue(new Error('provider down'))
    h.postOffer.mockRejectedValue(new Error('chat down'))
    const res = await proposeRedraft()
    expect(res.status).toBe(200)
  })
})

describe('live-draft pick trade', () => {
  it('posts the offer card into the two managers’ DM (the Chimmy review stays private)', async () => {
    h.prisma.draftPickTradeProposal.create.mockResolvedValue({
      id: 'dp-1', giveRound: 1, giveSlot: 1, receiveRound: 1, receiveSlot: 2, receiverRosterId: 'rB',
      status: 'pending', createdAt: new Date('2026-09-25T18:00:00Z'),
    })
    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/trade-proposals/route')
    const res = await POST(
      createMockNextRequest('http://localhost/api/leagues/l-1/draft/trade-proposals', {
        method: 'POST',
        body: { giveRound: 1, giveSlot: 1, receiveRound: 1, receiveSlot: 2, receiverRosterId: 'rB' },
      }) as never,
      { params: Promise.resolve({ leagueId: 'l-1' }) },
    )
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(h.postOffer).toHaveBeenCalledTimes(1))
    const call = h.postOffer.mock.calls[0][0] as { source: string; tradeId: string; load: () => unknown }
    expect(call).toMatchObject({ source: 'draft_pick', tradeId: 'dp-1' })
    await call.load()
    expect(h.loadDraftPick).toHaveBeenCalledWith({ leagueId: 'l-1', proposalId: 'dp-1', proposerUserId: 'uA', receiverRosterId: 'rB' })
  })
})
