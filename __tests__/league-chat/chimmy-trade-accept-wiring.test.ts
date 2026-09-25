// @vitest-environment node
/**
 * When the last manager accepts an AllFantasy league trade, Chimmy's trade card (with the take) goes
 * to league chat — once, with where the trade stands — and nothing on that path can fail the trade.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  postNative: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindMany: vi.fn(),
  tradeFindFirst: vi.fn(),
  tradeUpdate: vi.fn(),
}))

vi.mock('@/lib/league-chat/chimmyTradeMoment', () => ({ postNativeTradeMoment: h.postNative }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ postTradeOfferToDm: vi.fn(), postTradeStatusToDm: vi.fn() }))
vi.mock('@/lib/chat-notifications/tradeOfferSources', () => ({ loadNativeTradeOffer: vi.fn() }))
vi.mock('@/lib/notification-engine', () => ({ ingest: vi.fn(async () => ({ dispatched: true })), tradeEvent: (o: unknown) => o }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique, findUniqueOrThrow: h.leagueFindUnique },
    roster: { findFirst: vi.fn(), findMany: h.rosterFindMany, findUnique: vi.fn(), count: vi.fn() },
    afLeagueTrade: {
      findFirst: h.tradeFindFirst,
      findUniqueOrThrow: vi.fn(),
      update: h.tradeUpdate,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
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
  resolveLeagueTradeSettings: vi.fn().mockReturnValue({ processingDelayHours: 0 }),
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

import { acceptAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'

const L = 'league-1'
const roster = (id: string, platformUserId: string) => ({ id, leagueId: L, platformUserId })
const pendingTrade = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  status: 'pending',
  reviewType: 'commissioner',
  expiresAt: null,
  metadata: {},
  proposerRosterId: 'rA',
  receiverRosterId: 'rB',
  proposedByUserId: 'uA',
  items: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.postNative.mockResolvedValue({ posted: true, messageId: 'm1' })
  h.leagueFindUnique.mockResolvedValue({ id: L, settings: null, userId: 'commish' })
  h.tradeUpdate.mockResolvedValue({})
  h.rosterFindMany.mockResolvedValue([roster('rA', 'uA'), roster('rB', 'uB'), roster('rC', 'uC')])
})

describe('accepting a trade posts Chimmy’s trade card to league chat', () => {
  it('into commissioner review: the card says where the trade stands', async () => {
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    await expect(acceptAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'uB' })).resolves.toEqual({ status: 'awaiting_commissioner' })
    await vi.waitFor(() => expect(h.postNative).toHaveBeenCalledTimes(1))
    expect(h.postNative).toHaveBeenCalledWith({ tradeId: 't1', note: expect.stringMatching(/commissioner review/) })
  })

  it('into the league veto window: says so', async () => {
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ reviewType: 'league_vote' }))
    await acceptAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'uB' })
    await vi.waitFor(() => expect(h.postNative).toHaveBeenCalledTimes(1))
    expect(h.postNative).toHaveBeenCalledWith({ tradeId: 't1', note: expect.stringMatching(/veto window/) })
  })

  it('does not post while a multi-team trade still waits on another manager', async () => {
    h.tradeFindFirst.mockResolvedValue(
      pendingTrade({ items: [{ fromRosterId: 'rB', toRosterId: 'rC' }, { fromRosterId: 'rC', toRosterId: 'rA' }] }),
    )
    await expect(acceptAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'uB' })).resolves.toEqual({ status: 'pending' })
    await new Promise((r) => setTimeout(r, 20))
    expect(h.postNative).not.toHaveBeenCalled()
  })

  it('🛑 a chat path that rejects never fails the trade', async () => {
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    h.postNative.mockRejectedValue(new Error('chat down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(acceptAfLeagueTrade({ tradeId: 't1', leagueId: L, userId: 'uB' })).resolves.toEqual({ status: 'awaiting_commissioner' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[tradeService] league chat trade card failed', expect.anything()))
    warn.mockRestore()
  })
})
