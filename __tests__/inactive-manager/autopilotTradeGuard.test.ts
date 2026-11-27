/**
 * Chimmy autopilot: a team whose commissioner switched its trades off takes no offers — the proposal
 * is refused BEFORE anything is written or anyone is notified. A team that answers offers (the
 * default) lets a two-team offer through for Chimmy to answer on the hourly run.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '../helpers/createMockNextRequest'

const h = vi.hoisted(() => ({
  tradeMode: vi.fn(async (): Promise<string | null> => null),
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

vi.mock('@/lib/inactive-manager/inactiveManagerService', () => ({ autopilotTradeModeForOwner: h.tradeMode }))
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

/*
 * The route is loaded ONCE, before any test, with its own allowance. Loaded inside a test, compiling its
 * module graph counted against that test's 30s limit: on a loaded machine the compile alone took ~80s,
 * so every test here timed out without ever reaching the code under test (2026-11-26).
 */
let POST: typeof import('@/app/api/redraft/trade-proposals/route').POST
beforeAll(async () => {
  POST = (await import('@/app/api/redraft/trade-proposals/route')).POST
}, 240_000)

async function proposeRedraft() {
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
  it('are refused with a plain reason when its trades are off, and nothing is created or sent', async () => {
    h.tradeMode.mockResolvedValue('off')
    const res = await proposeRedraft()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'RECEIVER_ON_AUTOPILOT' })
    expect(h.tradeMode).toHaveBeenCalledWith('l-1', 'uB')
    expect(h.prisma.$transaction).not.toHaveBeenCalled()
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('go through for Chimmy to answer when the team answers offers', async () => {
    h.tradeMode.mockResolvedValue('answer')
    expect((await proposeRedraft()).status).toBe(200)
    h.prisma.redraftRoster.findFirst
      .mockResolvedValueOnce({ id: 'r-1', ownerId: 'uA', ownerName: 'dana@example.org', teamName: 'Dana Dynasty' })
      .mockResolvedValueOnce({ id: 'r-2', ownerId: 'uB', ownerName: 'Bob', teamName: null })
    h.tradeMode.mockResolvedValue('answer_and_send')
    expect((await proposeRedraft()).status).toBe(200)
  })

  it('go through as before when the receiver is not on autopilot, or the check itself fails', async () => {
    h.tradeMode.mockResolvedValue(null)
    expect((await proposeRedraft()).status).toBe(200)
    h.prisma.redraftRoster.findFirst
      .mockResolvedValueOnce({ id: 'r-1', ownerId: 'uA', ownerName: 'dana@example.org', teamName: 'Dana Dynasty' })
      .mockResolvedValueOnce({ id: 'r-2', ownerId: 'uB', ownerName: 'Bob', teamName: null })
    h.tradeMode.mockRejectedValue(new Error('db down'))
    expect((await proposeRedraft()).status).toBe(200)
  })
})
