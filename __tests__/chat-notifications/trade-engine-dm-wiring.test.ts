// @vitest-environment node
/**
 * The native trade engine posts every offer, and every answer to it, into the two managers' DM —
 * and a DM failure never touches the trade itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  postOffer: vi.fn(),
  postStatus: vi.fn(),
  loadNative: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  tradeCreate: vi.fn(),
  tradeFindFirst: vi.fn(),
  tradeUpdate: vi.fn(),
}))

vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({
  postTradeOfferToDm: h.postOffer,
  postTradeStatusToDm: h.postStatus,
}))
vi.mock('@/lib/chat-notifications/tradeOfferSources', () => ({ loadNativeTradeOffer: h.loadNative }))
vi.mock('@/lib/notification-engine', () => ({ ingest: vi.fn(async () => ({ dispatched: true })), tradeEvent: (o: unknown) => o }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique, findUniqueOrThrow: h.leagueFindUnique },
    roster: { findFirst: h.rosterFindFirst, findMany: h.rosterFindMany, findUnique: vi.fn(), count: vi.fn() },
    afLeagueTrade: {
      create: h.tradeCreate,
      findFirst: h.tradeFindFirst,
      findUniqueOrThrow: vi.fn(),
      update: h.tradeUpdate,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    afLeagueTradeVote: { upsert: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: vi.fn().mockResolvedValue('offer-1'),
  captureLiveTradeOutcome: vi.fn().mockResolvedValue('outcome-1'),
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({ assertLifecycleActionAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({ validateTradeAssets: vi.fn().mockReturnValue({ ok: true }) }))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({
  resolveLeagueTradeSettings: vi.fn().mockReturnValue({
    tradeReviewMode: 'commissioner',
    tradeDeadlineWeek: null,
    tradeReviewHours: 48,
    vetoThresholdPercent: 50,
    processingDelayHours: 0,
    tradesAllowed: true,
    faabTradingAllowed: true,
    draftPickTradingAllowed: true,
    devyTradingAllowed: true,
    c2cTradingAllowed: true,
  }),
}))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({ applyTradeAssetsInTransaction: vi.fn() }))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn(),
  appendAfTradeStatusHistory: vi.fn(),
  logAfTradeAudit: vi.fn(),
}))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined) }))

import {
  acceptAfLeagueTrade,
  cancelAfLeagueTrade,
  createAfLeagueTrade,
  rejectAfLeagueTrade,
} from '@/lib/league-trade-engine/tradeService'

const L = 'league-1'
const roster = (id: string, platformUserId: string) => ({ id, leagueId: L, platformUserId })

beforeEach(() => {
  vi.clearAllMocks()
  h.postOffer.mockResolvedValue({ posted: true })
  h.postStatus.mockResolvedValue({ posted: true })
  h.leagueFindUnique.mockResolvedValue({ id: L, settings: null, userId: 'commish' })
  h.tradeCreate.mockResolvedValue({ id: 'new-trade' })
  h.tradeUpdate.mockResolvedValue({})
})

async function offer(parentTradeId?: string) {
  h.rosterFindFirst.mockResolvedValueOnce(roster('rB', 'uB')).mockResolvedValueOnce(roster('rA', 'uA'))
  return createAfLeagueTrade({
    leagueId: L,
    proposedByUserId: 'uB',
    proposerRosterId: 'rB',
    receiverRosterId: 'rA',
    parentTradeId: parentTradeId ?? null,
    assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'rB', toRosterId: 'rA' }],
    metadata: { offerMessage: 'Fair for both of us?' },
  })
}

describe('an offer lands in the DM', () => {
  it('posts the new trade as a native offer, card built from the saved trade', async () => {
    await offer()
    await vi.waitFor(() => expect(h.postOffer).toHaveBeenCalledTimes(1))
    const call = h.postOffer.mock.calls[0][0] as { source: string; tradeId: string; load: () => unknown }
    expect(call).toMatchObject({ source: 'native', tradeId: 'new-trade' })
    await call.load()
    expect(h.loadNative).toHaveBeenCalledWith('new-trade')
    expect(h.postStatus).not.toHaveBeenCalled()
  })

  it('🛑 a counter first closes the parent’s card ("countered"), THEN posts the new offer', async () => {
    h.tradeFindFirst.mockResolvedValue({
      id: 'parent', rootTradeId: null, status: 'pending', metadata: {}, proposedByUserId: 'uA',
      proposerRosterId: 'rA', receiverRosterId: 'rB', items: [],
    })
    await offer('parent')
    await vi.waitFor(() => expect(h.postOffer).toHaveBeenCalledTimes(1))
    expect(h.postStatus).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'native', tradeId: 'parent', status: 'countered', actorUserId: 'uB' }),
    )
    expect(h.postStatus.mock.invocationCallOrder[0]).toBeLessThan(h.postOffer.mock.invocationCallOrder[0])
  })

  it('🛑 a DM path that throws or rejects never fails the trade', async () => {
    h.postOffer.mockRejectedValue(new Error('chat down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(offer()).resolves.toEqual({ id: 'new-trade' })
    await vi.waitFor(() => expect(h.postOffer).toHaveBeenCalled())
    warn.mockRestore()
  })
})

describe('every answer lands in the same DM', () => {
  it('reject by the receiver: "declined", named', async () => {
    h.tradeFindFirst.mockResolvedValue({ id: 't1', status: 'pending', proposerRosterId: 'rA', receiverRosterId: 'rB', proposedByUserId: 'uA', items: [] })
    h.rosterFindFirst.mockResolvedValue(roster('rB', 'uB'))
    await rejectAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'uB' })
    await vi.waitFor(() => expect(h.postStatus).toHaveBeenCalled())
    expect(h.postStatus).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 't1', status: 'rejected', actorUserId: 'uB' }))
  })

  it('cancel by the proposer: "pulled"', async () => {
    h.tradeFindFirst.mockResolvedValue({ id: 't1', status: 'pending', proposerRosterId: 'rA', receiverRosterId: 'rB', proposedByUserId: 'uA' })
    h.rosterFindFirst.mockResolvedValue(roster('rA', 'uA'))
    await cancelAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'uA' })
    await vi.waitFor(() => expect(h.postStatus).toHaveBeenCalled())
    expect(h.postStatus).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 't1', status: 'cancelled', actorUserId: 'uA' }))
  })

  it('accept into commissioner review: "accepted", with what happens next', async () => {
    h.tradeFindFirst.mockResolvedValue({
      id: 't1', status: 'pending', reviewType: 'commissioner', expiresAt: null, metadata: {},
      proposerRosterId: 'rA', receiverRosterId: 'rB', proposedByUserId: 'uA', items: [],
    })
    h.rosterFindMany.mockResolvedValue([roster('rA', 'uA'), roster('rB', 'uB')])
    await expect(acceptAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'uB' })).resolves.toEqual({ status: 'awaiting_commissioner' })
    await vi.waitFor(() => expect(h.postStatus).toHaveBeenCalled())
    expect(h.postStatus).toHaveBeenCalledWith(
      expect.objectContaining({ tradeId: 't1', status: 'accepted', actorUserId: 'uB', detail: expect.stringMatching(/commissioner review/) }),
    )
  })
})
