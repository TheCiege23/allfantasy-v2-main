// @vitest-environment node
/**
 * The trade deadline on the AF league engine, measured against the SERVER'S week at every entry point.
 *
 * The validator, the settings resolver and the deadline window are all REAL here — the week comes from
 * the league's `RedraftSeason` row in the prisma double, never from a request. What is asserted is the
 * engine's own answer: propose (Trade Center POST / counter / Chimmy all go through
 * `createAfLeagueTrade`), accept, and execution (commissioner approval, a commissioner processing a
 * bare offer, the scheduled-trade sweep).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  league: {} as Record<string, unknown>,
  season: null as null | { id: string; currentWeek: number; status: string },
  seasonFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  tradeCreate: vi.fn(),
  tradeFindFirst: vi.fn(),
  tradeFindUniqueOrThrow: vi.fn(),
  tradeUpdate: vi.fn(),
  claim: vi.fn(),
  applyAssets: vi.fn(),
  createAfLeagueTrade: vi.fn(),
  hold: vi.fn(async () => false),
}))

vi.mock('@/lib/prisma', () => {
  const tx = { afLeagueTrade: { updateMany: h.claim } }
  return {
    prisma: {
      league: {
        findUnique: vi.fn(async () => h.league),
        findUniqueOrThrow: vi.fn(async () => h.league),
      },
      redraftSeason: { findFirst: h.seasonFindFirst },
      roster: { findFirst: h.rosterFindFirst, findMany: h.rosterFindMany, count: vi.fn() },
      afLeagueTrade: {
        create: h.tradeCreate,
        findFirst: h.tradeFindFirst,
        findUniqueOrThrow: h.tradeFindUniqueOrThrow,
        update: h.tradeUpdate,
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  }
})
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ postTradeOfferToDm: vi.fn(), postTradeStatusToDm: vi.fn() }))
vi.mock('@/lib/chat-notifications/tradeOfferSources', () => ({ loadNativeTradeOffer: vi.fn() }))
vi.mock('@/lib/league-chat/chimmyTradeMoment', () => ({ postNativeTradeMoment: vi.fn() }))
vi.mock('@/lib/notification-engine', () => ({ ingest: vi.fn(async () => ({})), tradeEvent: (o: unknown) => o }))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: vi.fn().mockResolvedValue(null),
  captureLiveTradeOutcome: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/league-trade-engine/serverTradeDecision', () => ({ evaluateServerTradeDecision: async () => null }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ assertLifecycleActionAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({ applyTradeAssetsInTransaction: h.applyAssets }))
vi.mock('@/lib/league-trade-engine/tradeExecutionSnapshot', () => ({
  captureGenericRosterState: vi.fn(async () => ({})),
  genericTradeActorRole: () => 'commissioner',
  writeGenericTradeExecutionSnapshot: vi.fn(async () => undefined),
}))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn(),
  appendAfTradeStatusHistory: vi.fn(),
  logAfTradeAudit: vi.fn(),
}))
vi.mock('@/lib/integrity/enqueueCollusionScan', () => ({ enqueueCollusionScan: vi.fn() }))
vi.mock('@/lib/integrity/holdFlaggedTrades', () => ({ shouldHoldAcceptedTrade: h.hold }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined) }))

import {
  acceptAfLeagueTrade,
  commissionerAfTradeDecision,
  createAfLeagueTrade,
  finalizeAfLeagueTradeProcessing,
} from '@/lib/league-trade-engine/tradeService'
import { processDueScheduledTrades } from '@/lib/automation/jobs/trades/processDueScheduledTrades'

const L = 'league-1'
const roster = (id: string, platformUserId: string, players: string[]) => ({
  id, leagueId: L, platformUserId, playerData: { players }, faabRemaining: 100,
})
const RA = roster('rA', 'uA', ['a1', 'a2'])
const RB = roster('rB', 'uB', ['b1', 'b2'])

function leagueWith(over: Record<string, unknown> = {}) {
  return {
    id: L, settings: null, platform: 'allfantasy', lifecycleState: 'in_season', tradeDeadlineWeek: 11,
    lockAllMoves: false, bestBallMode: false, guillotineMode: false, leagueVariant: null, draftPickTrading: true,
    leagueType: 'dynasty', rosterSize: 20, season: 2026, userId: 'commish', ...over,
  }
}

function setWeek(currentWeek: number, status = 'active') {
  h.season = { id: 'season-1', currentWeek, status }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.league = leagueWith()
  setWeek(10)
  h.seasonFindFirst.mockImplementation(async () => h.season)
  h.rosterFindFirst.mockImplementation(async ({ where }: { where: { id: string } }) => [RA, RB].find((r) => r.id === where.id) ?? null)
  h.rosterFindMany.mockResolvedValue([RA, RB])
  h.tradeCreate.mockResolvedValue({ id: 'new-trade' })
  h.tradeUpdate.mockResolvedValue({})
  h.claim.mockResolvedValue({ count: 1 })
})

const propose = () =>
  createAfLeagueTrade({
    leagueId: L,
    proposedByUserId: 'uA',
    proposerRosterId: 'rA',
    receiverRosterId: 'rB',
    assets: [
      { itemType: 'player', itemReference: 'a1', fromRosterId: 'rA', toRosterId: 'rB' },
      { itemType: 'player', itemReference: 'b1', fromRosterId: 'rB', toRosterId: 'rA' },
    ],
  })

describe('propose: the deadline is checked against the season row, not the caller', () => {
  it('before the deadline (week 10, deadline 11) the offer is made', async () => {
    await expect(propose()).resolves.toEqual({ id: 'new-trade' })
  })

  it('the deadline week itself is still open (week 11, deadline 11)', async () => {
    setWeek(11)
    await expect(propose()).resolves.toEqual({ id: 'new-trade' })
  })

  it('🛑 after the deadline (week 12) the offer is refused — the Trade Center passes no week at all', async () => {
    setWeek(12)
    await expect(propose()).rejects.toThrow('Trade deadline has passed.')
    expect(h.tradeCreate).not.toHaveBeenCalled()
  })

  it('🛑 a caller-supplied week is ignored (the counter route used to forward the client\'s)', async () => {
    setWeek(12)
    const sneaky = { currentWeek: 1 } as Record<string, unknown>
    await expect(
      createAfLeagueTrade({
        leagueId: L, proposedByUserId: 'uA', proposerRosterId: 'rA', receiverRosterId: 'rB',
        assets: [{ itemType: 'player', itemReference: 'a1', fromRosterId: 'rA', toRosterId: 'rB' }],
        ...sneaky,
      }),
    ).rejects.toThrow('Trade deadline has passed.')
  })

  it('offseason: last season\'s week 17 does not block a trade (season complete)', async () => {
    setWeek(17, 'complete')
    await expect(propose()).resolves.toEqual({ id: 'new-trade' })
  })

  it('offseason: the next season\'s shell (setup) does not block a trade either', async () => {
    setWeek(0, 'setup')
    await expect(propose()).resolves.toEqual({ id: 'new-trade' })
  })

  it('offseason by lifecycle: no season row is even read', async () => {
    h.league = leagueWith({ lifecycleState: 'offseason' })
    setWeek(17)
    await expect(propose()).resolves.toEqual({ id: 'new-trade' })
    expect(h.seasonFindFirst).not.toHaveBeenCalled()
  })

  it('no deadline configured: nothing is read and nothing is refused', async () => {
    h.league = leagueWith({ tradeDeadlineWeek: null })
    setWeek(16)
    await expect(propose()).resolves.toEqual({ id: 'new-trade' })
    expect(h.seasonFindFirst).not.toHaveBeenCalled()
  })
})

const pendingTrade = (over: Record<string, unknown> = {}) => ({
  id: 't1', leagueId: L, status: 'pending', reviewType: 'commissioner', proposerRosterId: 'rA', receiverRosterId: 'rB',
  proposedByUserId: 'uA', metadata: {}, expiresAt: null, scheduledProcessAt: null, processingDelayHours: 0,
  vetoThresholdPercent: 50, acceptedAt: null,
  items: [
    { itemType: 'player', itemReference: 'a1', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: {} },
    { itemType: 'player', itemReference: 'b1', fromRosterId: 'rB', toRosterId: 'rA', faabAmount: null, metadata: {} },
  ],
  ...over,
})

describe('accept: the deadline binds at acceptance', () => {
  it('before the deadline, an acceptance moves the trade into commissioner review', async () => {
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).resolves.toEqual({ status: 'awaiting_commissioner' })
  })

  it('🛑 after the deadline, acceptance is refused and nothing is written', async () => {
    setWeek(12)
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).rejects.toThrow('Trade deadline passed after Week 11.')
    expect(h.tradeUpdate).not.toHaveBeenCalled()
  })

  it('🛑 an instant-review acceptance after the deadline does not settle', async () => {
    setWeek(12)
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ reviewType: 'instant' }))
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).rejects.toThrow('Trade deadline passed after Week 11.')
    expect(h.applyAssets).not.toHaveBeenCalled()
  })

  it('offseason acceptance is not blocked by last season\'s deadline', async () => {
    setWeek(17, 'complete')
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).resolves.toEqual({ status: 'awaiting_commissioner' })
  })
})

describe('accept: "hold flagged trades" (lib/integrity/holdFlaggedTrades.ts)', () => {
  it('a flagged instant trade is held for commissioner review and does not settle', async () => {
    h.hold.mockResolvedValueOnce(true)
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ reviewType: 'instant' }))
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).resolves.toEqual({ status: 'awaiting_commissioner' })
    expect(h.hold).toHaveBeenCalledWith(expect.objectContaining({ leagueId: L, ref: { kind: 'af', tradeId: 't1' } }))
    expect(h.applyAssets).not.toHaveBeenCalled()
    expect(h.tradeUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'awaiting_commissioner' }) }))
  })

  it('a trade already going to the commissioner is not scanned twice', async () => {
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ reviewType: 'commissioner' }))
    await acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })
    expect(h.hold).not.toHaveBeenCalled()
  })
})

describe('execution: a trade ACCEPTED before the deadline still finishes its review after it', () => {
  it('commissioner approval in week 12 of a trade accepted in week 11 processes', async () => {
    setWeek(12)
    const awaiting = pendingTrade({ status: 'awaiting_commissioner', acceptedAt: new Date() })
    h.tradeFindFirst.mockResolvedValue(awaiting)
    h.tradeFindUniqueOrThrow.mockResolvedValue(awaiting)
    await commissionerAfTradeDecision({ tradeId: 't1', leagueId: L, userId: 'commish', decision: 'approve' })
    expect(h.applyAssets).toHaveBeenCalledTimes(1)
  })

  it('a processing-delay trade scheduled before the deadline is settled by the sweep after it', async () => {
    setWeek(12)
    const scheduled = pendingTrade({ status: 'scheduled', scheduledProcessAt: new Date(Date.now() - 60_000) })
    h.tradeFindUniqueOrThrow.mockResolvedValue(scheduled)
    const prisma = (await import('@/lib/prisma')).prisma as unknown as {
      afLeagueTrade: { findMany?: unknown }
      afLeagueTradeStatusHistory?: unknown
    }
    prisma.afLeagueTrade.findMany = vi.fn(async () => [{ id: 't1', proposedByUserId: 'uA' }])
    prisma.afLeagueTradeStatusHistory = { findFirst: vi.fn(async () => null) }
    const out = await processDueScheduledTrades()
    expect(out).toMatchObject({ due: 1, processed: 1, failures: [] })
    expect(h.applyAssets).toHaveBeenCalledTimes(1)
  })

  it('🛑 a commissioner processing a still-PENDING offer after the deadline is refused (nobody accepted it in time)', async () => {
    setWeek(12)
    h.tradeFindUniqueOrThrow.mockResolvedValue(pendingTrade())
    await expect(finalizeAfLeagueTradeProcessing({ tradeId: 't1', actorUserId: 'commish' })).rejects.toThrow('Trade deadline passed after Week 11.')
    expect(h.applyAssets).not.toHaveBeenCalled()
  })

  it('the commissioner override (process route, `commissionerOverride: true`) forces that offer through', async () => {
    setWeek(12)
    h.tradeFindUniqueOrThrow.mockResolvedValue(pendingTrade())
    await finalizeAfLeagueTradeProcessing({ tradeId: 't1', actorUserId: 'commish', commissionerOverride: true })
    expect(h.applyAssets).toHaveBeenCalledTimes(1)
  })

  it('a close time in settings refuses acceptance from that moment, and names it', async () => {
    h.league = leagueWith({ tradeDeadlineWeek: null, settings: { trade_deadline_at: '2020-01-01T00:00:00.000Z' }, timezone: 'America/New_York' })
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).rejects.toThrow(/The trade deadline passed on /)
  })

  it('the same pending offer processed before the deadline goes through', async () => {
    h.tradeFindUniqueOrThrow.mockResolvedValue(pendingTrade())
    await finalizeAfLeagueTradeProcessing({ tradeId: 't1', actorUserId: 'commish' })
    expect(h.applyAssets).toHaveBeenCalledTimes(1)
  })
})
