// @vitest-environment node
/**
 * A dynasty league's separate deadline for pick trades (lib/trade-deadline/pickTradeDeadline.ts), on the AF
 * league engine at propose, accept and a commissioner processing a bare offer. Same harness as
 * trade-deadline-enforcement.test.ts: the validator, the settings resolver and the deadline window are
 * REAL, and the week comes from the league's season row. The trade deadline is week 11 throughout.
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
  createAfLeagueTrade,
  finalizeAfLeagueTradeProcessing,
} from '@/lib/league-trade-engine/tradeService'

const L = 'league-1'
const roster = (id: string, platformUserId: string, players: string[]) => ({
  id, leagueId: L, platformUserId, playerData: { players, draftPicks: [{ id: `${id}-2027-1`, season: 2027, round: 1 }] }, faabRemaining: 100,
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

const PICKS = [
  { itemType: 'rookie_pick', itemReference: 'rA-2027-1', fromRosterId: 'rA', toRosterId: 'rB' },
  { itemType: 'rookie_pick', itemReference: 'rB-2027-1', fromRosterId: 'rB', toRosterId: 'rA' },
] as const
const PICK_FOR_PLAYER = [
  { itemType: 'rookie_pick', itemReference: 'rA-2027-1', fromRosterId: 'rA', toRosterId: 'rB' },
  { itemType: 'player', itemReference: 'b1', fromRosterId: 'rB', toRosterId: 'rA' },
] as const

const proposeItems = (assets: ReadonlyArray<Record<string, unknown>>) =>
  createAfLeagueTrade({ leagueId: L, proposedByUserId: 'uA', proposerRosterId: 'rA', receiverRosterId: 'rB', assets: assets as never })
const items = (assets: ReadonlyArray<Record<string, unknown>>) => assets.map((a) => ({ faabAmount: null, metadata: {}, ...a }))
const rule = (r: unknown) => leagueWith({ settings: { pick_trade_deadline: r } })

describe('pick trades open all season', () => {
  beforeEach(() => {
    h.league = rule({ mode: 'open' })
    setWeek(14)
  })

  it('a picks-only offer is made and accepted after the trade deadline', async () => {
    await expect(proposeItems(PICKS)).resolves.toEqual({ id: 'new-trade' })
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ items: items(PICKS) }))
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).resolves.toEqual({ status: 'awaiting_commissioner' })
  })

  it('🛑 a pick for a player is a player trade, and the trade deadline still closes it', async () => {
    await expect(proposeItems(PICK_FOR_PLAYER)).rejects.toThrow('Trade deadline has passed.')
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ items: items(PICK_FOR_PLAYER) }))
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).rejects.toThrow('Trade deadline passed after Week 11.')
    expect(h.tradeUpdate).not.toHaveBeenCalled()
  })

  it('🛑 FAAB with the picks makes it a player trade too', async () => {
    const withFaab = [...PICKS, { itemType: 'faab', faabAmount: 5, fromRosterId: 'rA', toRosterId: 'rB' }]
    await expect(proposeItems(withFaab)).rejects.toThrow('Trade deadline has passed.')
  })

  it('the trade deadline’s close time does not close pick trades either', async () => {
    h.league = leagueWith({ settings: { pick_trade_deadline: { mode: 'open' }, trade_deadline_at: '2020-01-01T00:00:00.000Z' } })
    await expect(proposeItems(PICKS)).resolves.toEqual({ id: 'new-trade' })
  })
})

describe('pick trades close after their own week', () => {
  it('later than the trade deadline: open in week 14, refused in week 17', async () => {
    h.league = rule({ mode: 'week', week: 16 })
    setWeek(14)
    await expect(proposeItems(PICKS)).resolves.toEqual({ id: 'new-trade' })
    setWeek(17)
    await expect(proposeItems(PICKS)).rejects.toThrow('Pick trades closed after Week 16.')
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ items: items(PICKS) }))
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).rejects.toThrow('Pick trades closed after Week 16.')
  })

  it('🛑 earlier than the trade deadline: pick trades close in week 9 while player trades are still open', async () => {
    h.league = rule({ mode: 'week', week: 8 })
    setWeek(9)
    await expect(proposeItems(PICKS)).rejects.toThrow('Pick trades closed after Week 8.')
    h.tradeFindUniqueOrThrow.mockResolvedValue(pendingTrade({ items: items(PICKS) }))
    await expect(finalizeAfLeagueTradeProcessing({ tradeId: 't1', actorUserId: 'commish' })).rejects.toThrow('Pick trades closed after Week 8.')
    expect(h.applyAssets).not.toHaveBeenCalled()
    await expect(proposeItems(PICK_FOR_PLAYER)).resolves.toEqual({ id: 'new-trade' })
  })

  it('out of season nothing closes', async () => {
    h.league = rule({ mode: 'week', week: 8 })
    setWeek(17, 'complete')
    await expect(proposeItems(PICKS)).resolves.toEqual({ id: 'new-trade' })
  })
})

describe('the default, and leagues the rule is not for', () => {
  it('with no rule, pick trades close with the trade deadline (as before)', async () => {
    setWeek(12)
    await expect(proposeItems(PICKS)).rejects.toThrow('Trade deadline has passed.')
  })

  it('🛑 a redraft league ignores a stored rule', async () => {
    h.league = leagueWith({ leagueType: 'redraft', settings: { pick_trade_deadline: { mode: 'open' } } })
    setWeek(12)
    await expect(proposeItems(PICKS)).rejects.toThrow('Trade deadline has passed.')
  })
})
