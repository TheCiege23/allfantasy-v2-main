import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A dynasty league can trade in the offseason — a future-pick-only offer included — while a redraft
 * league's offseason still refuses it. Same production-path double as native-future-pick-offer.test.ts,
 * except that the lifecycle gate is the REAL one, reading the league row below.
 */

const h = vi.hoisted(() => ({
  rosterFindFirst: vi.fn(),
  parentFindFirst: vi.fn(),
  txCreate: vi.fn(),
  txUpdate: vi.fn(),
  txUpdateMany: vi.fn(),
  order: [] as string[],
  validate: vi.fn(),
  loadNative: vi.fn(),
  leagueFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    afLeagueTrade: {
      create: (...a: unknown[]) => { h.order.push('create'); return h.txCreate(...a) },
      update: (...a: unknown[]) => { h.order.push('update'); return h.txUpdate(...a) },
      updateMany: (...a: unknown[]) => { h.order.push('claim'); return h.txUpdateMany(...a) },
    },
    tradeManagerStrategy: {},
  }
  return {
    prisma: {
      league: { findUnique: h.leagueFindUnique },
      draftSession: { count: vi.fn().mockResolvedValue(1) },
      redraftSeason: { count: vi.fn().mockResolvedValue(1) },
      roster: { findFirst: h.rosterFindFirst, findMany: vi.fn() },
      afLeagueTrade: { findFirst: h.parentFindFirst, create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      // Present, so createAfLeagueTrade takes the transactional production path.
      tradeDecisionSnapshot: {},
      $transaction: async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  }
})
vi.mock('@/lib/league-trade-engine/tradeDecisionSnapshot', () => ({
  buildTradeDecisionSnapshot: () => ({}),
  writeTradeDecisionSnapshot: async () => undefined,
}))
vi.mock('@/lib/league-trade-engine/managerStrategy', () => ({ getTradeManagerStrategy: async () => null }))
vi.mock('@/lib/league-trade-engine/serverTradeDecision', () => ({ evaluateServerTradeDecision: async () => null }))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: vi.fn().mockResolvedValue(null),
  captureLiveTradeOutcome: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({ validateTradeAssets: h.validate }))
vi.mock('@/lib/league-trade-engine/nativeFuturePicks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-trade-engine/nativeFuturePicks')>()),
  loadNativeFuturePicks: h.loadNative,
}))
vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({
  resolveLeagueTradeSettings: () => ({ tradeReviewMode: 'instant', processingDelayHours: 0, vetoThresholdPercent: 50 }),
}))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({ applyTradeAssetsInTransaction: vi.fn() }))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn().mockResolvedValue(undefined),
  appendAfTradeStatusHistory: vi.fn().mockResolvedValue(undefined),
  logAfTradeAudit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({
  assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/notification-engine', () => ({ ingest: vi.fn().mockResolvedValue(undefined), tradeEvent: (e: unknown) => e }))

import { createAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'

const roster = (id: string, platformUserId: string) => ({ id, leagueId: 'L', platformUserId })
const owners = new Map([['fdp:2027:1:ra', 'ra']])

function league(lifecycleState: string, leagueType: string) {
  return {
    id: 'L', userId: 'owner', season: 2026, settings: null, platform: 'manual',
    lifecycleState, locked: false, emergencyPaused: false, lifecycleMetadata: null, status: null,
    leagueType, isDynasty: leagueType === 'dynasty',
  }
}

function proposePickOnly() {
  h.rosterFindFirst.mockResolvedValueOnce(roster('ra', 'ua')).mockResolvedValueOnce(roster('rb', 'ub'))
  return createAfLeagueTrade({
    leagueId: 'L',
    proposedByUserId: 'ua',
    proposerRosterId: 'ra',
    receiverRosterId: 'rb',
    assets: [{ itemType: 'rookie_pick', itemReference: 'fdp:2027:1:ra', fromRosterId: 'ra', toRosterId: 'rb' }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.validate.mockReturnValue({ ok: true })
  h.loadNative.mockResolvedValue({ picks: [], seasons: [2027, 2028, 2029], rounds: 2, ownerByPickId: owners })
  h.txCreate.mockResolvedValue({ id: 'trade-1' })
  h.txUpdate.mockResolvedValue({})
  h.txUpdateMany.mockResolvedValue({ count: 1 })
})

describe('offseason trade proposals', () => {
  it('dynasty: a future-pick-only offer is accepted in the offseason', async () => {
    h.leagueFindUnique.mockResolvedValue(league('offseason', 'dynasty'))
    await expect(proposePickOnly()).resolves.toEqual({ id: 'trade-1' })
    expect(h.txCreate).toHaveBeenCalledTimes(1)
  })

  it('dynasty: accepted in pre_draft before the rookie draft', async () => {
    h.leagueFindUnique.mockResolvedValue(league('pre_draft', 'dynasty'))
    await expect(proposePickOnly()).resolves.toEqual({ id: 'trade-1' })
  })

  it('redraft: still refused in the offseason, and nothing is written', async () => {
    h.leagueFindUnique.mockResolvedValue(league('offseason', 'redraft'))
    await expect(proposePickOnly()).rejects.toThrow('Action "trade_act" is not allowed in lifecycle state "offseason"')
    expect(h.txCreate).not.toHaveBeenCalled()
  })
})
