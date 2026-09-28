import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 ANY LEAGUE MEMBER COULD KILL ANY TRADE BY "COUNTERING" IT. (Trade audit, 2026-09-24.)
 *
 * `createAfLeagueTrade` looked the parent up by id + league and nothing else, then set it to
 * 'countered' unconditionally. The counter route takes both roster ids from the request body, so a
 * manager who owned ANY roster could post a counter to a trade between two other managers and end
 * it — including one already accepted, awaiting commissioner review, or processed.
 *
 * These tests drive the PRODUCTION path: the prisma double carries `tradeDecisionSnapshot`, so the
 * trade is created inside `$transaction`. The older counter suites use a reduced double that takes
 * the fallback branch, which is why they could not have caught an ordering bug in the transaction.
 */

const h = vi.hoisted(() => ({
  rosterFindFirst: vi.fn(),
  parentFindFirst: vi.fn(),
  txCreate: vi.fn(),
  txUpdate: vi.fn(),
  txUpdateMany: vi.fn(),
  order: [] as string[],
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
vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({ validateTradeAssets: () => ({ ok: true }) }))
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

import { counterRefusal, createAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'

/* A offered a trade to B. C owns a roster in the league and is not part of it. */
const PARENT = {
  id: 'parent',
  leagueId: 'L',
  status: 'pending',
  expiresAt: null as Date | null,
  proposerRosterId: 'ra',
  receiverRosterId: 'rb',
  proposedByUserId: 'ua',
  rootTradeId: null,
  metadata: {},
  items: [{ fromRosterId: 'ra', toRosterId: 'rb' }],
}
const roster = (id: string, platformUserId: string) => ({ id, leagueId: 'L', platformUserId })

function counterAs(user: string, from: string, to: string) {
  h.rosterFindFirst
    .mockResolvedValueOnce(roster(from, user))
    .mockResolvedValueOnce(roster(to, to === 'ra' ? 'ua' : 'ux'))
  return createAfLeagueTrade({
    leagueId: 'L',
    proposedByUserId: user,
    proposerRosterId: from,
    receiverRosterId: to,
    parentTradeId: 'parent',
    assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: from, toRosterId: to }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.order.length = 0
  h.parentFindFirst.mockResolvedValue({ ...PARENT })
  h.txUpdateMany.mockResolvedValue({ count: 1 })
  h.txCreate.mockResolvedValue({ id: 'counter' })
  h.txUpdate.mockResolvedValue({})
})

describe('counterRefusal (pure)', () => {
  it('the manager it was offered to may counter a pending offer', () => {
    expect(counterRefusal(PARENT, 'rb')).toBeNull()
  })

  it('🛑 a roster outside the trade may not', () => {
    expect(counterRefusal(PARENT, 'rc')).toBe('Only a manager this trade was offered to can counter it')
  })

  it('the proposer withdraws its own offer; it does not counter it', () => {
    expect(counterRefusal(PARENT, 'ra')).toBe('Only a manager this trade was offered to can counter it')
  })

  it.each(['awaiting_commissioner', 'awaiting_votes', 'scheduled', 'processed', 'rejected', 'countered'])(
    '🛑 a %s trade cannot be countered',
    (status) => {
      expect(counterRefusal({ ...PARENT, status }, 'rb')).toBe('Only a pending trade can be countered')
    },
  )

  it('an expired offer cannot be countered', () => {
    expect(counterRefusal({ ...PARENT, expiresAt: new Date('2026-01-01') }, 'rb', new Date('2026-02-01'))).toBe('Trade expired')
  })

  it('in a multi-team trade, a third participant (seen only in the items) may counter', () => {
    const three = { ...PARENT, items: [...PARENT.items, { fromRosterId: 'rb', toRosterId: 'rd' }] }
    expect(counterRefusal(three, 'rd')).toBeNull()
  })
})

describe('🛑 createAfLeagueTrade enforces it, on the production transaction path', () => {
  it('B counters A’s offer: the parent is claimed FIRST, then the counter is created and linked', async () => {
    const { id } = await counterAs('ub', 'rb', 'ra')
    expect(id).toBe('counter')
    expect(h.order).toEqual(['claim', 'create', 'update'])
    expect(h.txUpdateMany).toHaveBeenCalledWith({
      where: { id: 'parent', status: 'pending' },
      data: { status: 'countered' },
    })
    expect(h.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'parent' }, data: { metadata: { counterTradeId: 'counter' } } }),
    )
  })

  it('🛑 C, who owns a roster but is not in the trade, cannot kill it', async () => {
    await expect(counterAs('uc', 'rc', 'ra')).rejects.toThrow('Only a manager this trade was offered to can counter it')
    expect(h.order).toEqual([]) // parent untouched, nothing created
  })

  it('🛑 a trade already accepted and awaiting review cannot be overwritten', async () => {
    h.parentFindFirst.mockResolvedValue({ ...PARENT, status: 'awaiting_commissioner' })
    await expect(counterAs('ub', 'rb', 'ra')).rejects.toThrow('Only a pending trade can be countered')
    expect(h.order).toEqual([])
  })

  it('🛑 accepted between the read and the write: the claim loses and NO counter is created', async () => {
    // The parent READ as pending, but by the time the counter writes, accept has moved it.
    h.txUpdateMany.mockResolvedValue({ count: 0 })
    await expect(counterAs('ub', 'rb', 'ra')).rejects.toThrow(/changed before your counter was sent/)
    expect(h.order).toEqual(['claim'])
    expect(h.txCreate).not.toHaveBeenCalled()
  })
})
