/**
 * Chimmy autopilot: a team nobody is running takes no trade offers. The proposal is refused BEFORE
 * anything is written or anyone is notified.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  onAutopilot: vi.fn(async () => false),
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

vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ isOwnerOnAutopilot: h.onAutopilot }))
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

describe('trade offers to a team on Chimmy autopilot', () => {
  it('are refused with a plain reason, and nothing is created or sent', async () => {
    h.onAutopilot.mockResolvedValue(true)
    const res = await proposeRedraft()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'RECEIVER_ON_AUTOPILOT' })
    expect(h.onAutopilot).toHaveBeenCalledWith('l-1', 'uB')
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('go through as before when the receiver is not on autopilot', async () => {
    h.onAutopilot.mockResolvedValue(false)
    expect((await proposeRedraft()).status).toBe(200)
  })
})
