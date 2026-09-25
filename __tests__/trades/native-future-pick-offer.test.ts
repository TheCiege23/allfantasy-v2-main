import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Proposing a trade that offers a native dynasty league’s future pick. Those picks live in
 * `future_draft_picks`, not `playerData`, so validation must be handed the league’s inventory —
 * without it every such offer is refused as "not on the sending roster". Reuses the production-path
 * double from counter-authorization.test.ts.
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
      league: { findUnique: vi.fn().mockResolvedValue({ id: 'L', season: 2026, settings: null }) },
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
vi.mock('@/server/services/leagueLifecycleService', () => ({
  assertLifecycleActionAllowed: vi.fn().mockResolvedValue({ ok: true }),
}))
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

function propose(itemType: string, itemReference: string) {
  h.rosterFindFirst.mockResolvedValueOnce(roster('ra', 'ua')).mockResolvedValueOnce(roster('rb', 'ub'))
  return createAfLeagueTrade({
    leagueId: 'L',
    proposedByUserId: 'ua',
    proposerRosterId: 'ra',
    receiverRosterId: 'rb',
    assets: [{ itemType: itemType as never, itemReference, fromRosterId: 'ra', toRosterId: 'rb' }],
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

describe('offering a native future pick', () => {
  it('hands validation the league’s pick inventory', async () => {
    await propose('rookie_pick', 'fdp:2027:1:ra')
    expect(h.loadNative).toHaveBeenCalledWith('L')
    expect(h.validate.mock.calls[0]![0].nativeFuturePickOwners).toBe(owners)
  })

  it('a trade with no native pick never reads it', async () => {
    await propose('player', 'p1')
    expect(h.loadNative).not.toHaveBeenCalled()
    expect(h.validate.mock.calls[0]![0].nativeFuturePickOwners).toBeNull()
  })

  it('an inventory that fails to load is refused by validation, not thrown', async () => {
    h.loadNative.mockRejectedValue(new Error('db down'))
    await propose('rookie_pick', 'fdp:2027:1:ra')
    expect(h.validate.mock.calls[0]![0].nativeFuturePickOwners).toBeNull()
  })
})
