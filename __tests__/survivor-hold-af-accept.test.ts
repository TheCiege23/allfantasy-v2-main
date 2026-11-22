// @vitest-environment node
/**
 * Survivor "if the trade check can't run: hold it for the commissioner" on the AF league engine's
 * accept (`acceptAfLeagueTrade`): an instant trade is not settled but moved to `awaiting_commissioner`,
 * and the proposer's notice, the DM and the league-chat card follow League.language. Built on the
 * harness of trades/trade-deadline-enforcement.test.ts; the Survivor check is pinned.
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


const sv = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@/lib/survivor/survivorTradeRuleHook', () => ({ checkSurvivorTradeRules: sv.check }))

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

beforeEach(() => {
  sv.check.mockResolvedValue({ ok: true, skipped: 'error', holdForCommissioner: true })
})

describe('AF accept, when the Survivor check could not run and the league holds', () => {
  it('an instant trade does not settle: it waits for the commissioner, told in Spanish for a Spanish league', async () => {
    h.league = leagueWith({ language: 'es', survivorMode: true })
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ reviewType: 'instant' }))
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })).resolves.toEqual({ status: 'awaiting_commissioner' })
    expect(h.applyAssets).not.toHaveBeenCalled()
    expect(h.tradeUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'awaiting_commissioner' }) }))
    // The integrity scan is not needed: the Survivor hold already decided.
    expect(h.hold).not.toHaveBeenCalled()
    const { ingest } = await import('@/lib/notification-engine')
    await vi.waitFor(() => expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('queda retenido hasta que el comisionado') })))
    const { postNativeTradeMoment } = await import('@/lib/league-chat/chimmyTradeMoment')
    await vi.waitFor(() => expect(postNativeTradeMoment).toHaveBeenCalledWith(expect.objectContaining({ note: 'Aceptado. Retenido para el comisionado: la revisión de reglas de Survivor no pudo hacerse.' })))
  })

  it('an English league gets the English notice', async () => {
    h.league = leagueWith({ language: 'en', survivorMode: true })
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ reviewType: 'instant' }))
    await acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L })
    const { ingest } = await import('@/lib/notification-engine')
    await vi.waitFor(() => expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('The Survivor trade check could not run') })))
  })

  it('a check that ran clean settles the instant trade as before (control)', async () => {
    sv.check.mockResolvedValue({ ok: true, bypassed: false })
    h.league = leagueWith({ survivorMode: true })
    h.tradeFindFirst.mockResolvedValue(pendingTrade({ reviewType: 'instant' }))
    h.tradeFindUniqueOrThrow.mockResolvedValue(pendingTrade({ reviewType: 'instant' }))
    await acceptAfLeagueTrade({ tradeId: 't1', userId: 'uB', leagueId: L }).catch(() => undefined)
    expect(h.tradeUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'awaiting_commissioner' }) }))
  })
})
