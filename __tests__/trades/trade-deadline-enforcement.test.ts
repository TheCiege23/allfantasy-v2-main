import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE TRADE DEADLINE AND "LOCK ALL MOVES" WERE NOT ENFORCED FOR NATIVE TRADES (2026-10-19).
 *
 * `isPastTradeDeadline` returns false for a null week, and the Trade Center propose path never
 * supplied one; the counter route trusted `body.currentWeek`; nothing re-checked at accept time or
 * before a delayed trade executed. These drive the REAL settings resolver and validator — only the
 * persistence and side-effect edges are doubled — so the week the server resolves is what decides.
 */

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  seasonFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterFindMany: vi.fn(),
  tradeCreate: vi.fn(),
  tradeFindFirst: vi.fn(),
  tradeFindUniqueOrThrow: vi.fn(),
  tradeUpdate: vi.fn(),
  tradeUpdateMany: vi.fn(),
  txUpdateMany: vi.fn(),
  statusHistory: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique, findUniqueOrThrow: h.leagueFindUnique },
    redraftSeason: { findFirst: h.seasonFindFirst },
    roster: { findFirst: h.rosterFindFirst, findMany: h.rosterFindMany, findUnique: vi.fn(), count: vi.fn() },
    afLeagueTrade: {
      create: h.tradeCreate,
      findFirst: h.tradeFindFirst,
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: h.tradeFindUniqueOrThrow,
      update: h.tradeUpdate,
      updateMany: h.tradeUpdateMany,
    },
    leagueTeam: { findMany: vi.fn().mockResolvedValue([]) },
    afLeagueTradeVote: { upsert: vi.fn(), count: vi.fn() },
    $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ afLeagueTrade: { updateMany: h.txUpdateMany, update: vi.fn() } }),
  },
}))

vi.mock('@/lib/notification-engine', () => ({ ingest: vi.fn().mockResolvedValue({}), tradeEvent: (e: unknown) => e }))
vi.mock('@/lib/league-trade-engine/serverTradeDecision', () => ({ evaluateServerTradeDecision: async () => null }))
vi.mock('@/lib/league-trade-engine/managerStrategy', () => ({ getTradeManagerStrategy: async () => null }))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: vi.fn().mockResolvedValue(null),
  captureLiveTradeOutcome: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({ assertLifecycleActionAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({ applyTradeAssetsInTransaction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/league-trade-engine/tradeExecutionSnapshot', () => ({
  captureGenericRosterState: vi.fn().mockResolvedValue({}),
  genericTradeActorRole: () => 'user',
  writeGenericTradeExecutionSnapshot: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn().mockResolvedValue(undefined),
  appendAfTradeStatusHistory: h.statusHistory,
  logAfTradeAudit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined) }))

import { acceptAfLeagueTrade, createAfLeagueTrade, finalizeAfLeagueTradeProcessing } from '@/lib/league-trade-engine/tradeService'
import { buildEngineTestLeague, buildEngineTestRoster } from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

const LEAGUE = 'l1'
const ra = buildEngineTestRoster('ra', LEAGUE, 'ua', { players: ['p1'] })
const rb = buildEngineTestRoster('rb', LEAGUE, 'ub', { players: ['p2'] })
const ASSETS = [
  { itemType: 'player' as const, itemReference: 'p1', fromRosterId: 'ra', toRosterId: 'rb' },
  { itemType: 'player' as const, itemReference: 'p2', fromRosterId: 'rb', toRosterId: 'ra' },
]

function league(over: Record<string, unknown> = {}) {
  return buildEngineTestLeague({
    id: LEAGUE,
    sport: 'NBA',
    tradeDeadlineWeek: 8,
    lockAllMoves: false,
    tradeReviewMode: 'none',
    ...over,
  } as never)
}

function propose(extra: Record<string, unknown> = {}) {
  h.rosterFindFirst.mockResolvedValueOnce(ra).mockResolvedValueOnce(rb)
  return createAfLeagueTrade({
    leagueId: LEAGUE,
    proposedByUserId: 'ua',
    proposerRosterId: 'ra',
    receiverRosterId: 'rb',
    assets: ASSETS,
    ...extra,
  } as never)
}

const pendingTrade = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  leagueId: LEAGUE,
  status: 'pending',
  reviewType: 'instant',
  expiresAt: null,
  proposerRosterId: 'ra',
  receiverRosterId: 'rb',
  proposedByUserId: 'ua',
  processingDelayHours: 0,
  scheduledProcessAt: null,
  metadata: {},
  items: ASSETS.map((a, i) => ({ id: `i${i}`, ...a, faabAmount: null, metadata: {} })),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.leagueFindUnique.mockResolvedValue(league())
  h.seasonFindFirst.mockResolvedValue({ currentWeek: 5 })
  h.tradeCreate.mockResolvedValue({ id: 'new-trade' })
  h.tradeUpdate.mockResolvedValue({})
  h.tradeUpdateMany.mockResolvedValue({ count: 1 })
  h.txUpdateMany.mockResolvedValue({ count: 1 })
  h.statusHistory.mockResolvedValue(undefined)
  h.rosterFindMany.mockResolvedValue([ra, rb])
})

describe('proposal — the server resolves the week', () => {
  it('control: before the deadline, an NBA proposal is created', async () => {
    await expect(propose()).resolves.toEqual({ id: 'new-trade' })
  })

  it('refuses a proposal after the deadline week, read from RedraftSeason.currentWeek', async () => {
    h.seasonFindFirst.mockResolvedValue({ currentWeek: 10 })
    await expect(propose()).rejects.toThrow(/trade deadline has passed/i)
    expect(h.tradeCreate).not.toHaveBeenCalled()
  })

  it('ignores a client-supplied week (a client sending week 1 in week 10 is still refused)', async () => {
    h.seasonFindFirst.mockResolvedValue({ currentWeek: 10 })
    await expect(propose({ currentWeek: 1 })).rejects.toThrow(/trade deadline has passed/i)
  })

  it('falls back to League.settings.currentWeek when no season row exists', async () => {
    h.seasonFindFirst.mockResolvedValue(null)
    h.leagueFindUnique.mockResolvedValue(league({ settings: { currentWeek: 9 } }))
    await expect(propose()).rejects.toThrow(/trade deadline has passed/i)
  })

  it('no deadline configured: no deadline applies (unchanged)', async () => {
    h.seasonFindFirst.mockResolvedValue({ currentWeek: 20 })
    h.leagueFindUnique.mockResolvedValue(league({ tradeDeadlineWeek: null }))
    await expect(propose()).resolves.toEqual({ id: 'new-trade' })
  })

  it('lockAllMoves blocks an NBA proposal with its own message', async () => {
    h.leagueFindUnique.mockResolvedValue(league({ lockAllMoves: true }))
    await expect(propose()).rejects.toThrow(/locked by the commissioner/i)
  })
})

describe('acceptance — re-checked at accept time', () => {
  it('control: before the deadline an instant trade processes', async () => {
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    h.tradeFindUniqueOrThrow.mockResolvedValue(pendingTrade())
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'ub', leagueId: LEAGUE })).resolves.toEqual({ status: 'processed' })
  })

  it('refuses acceptance after the deadline, and moves nothing', async () => {
    h.seasonFindFirst.mockResolvedValue({ currentWeek: 9 })
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    h.tradeFindUniqueOrThrow.mockResolvedValue(pendingTrade())
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'ub', leagueId: LEAGUE })).rejects.toThrow(/trade deadline has passed/i)
    expect(h.txUpdateMany).not.toHaveBeenCalled()
  })

  it('refuses acceptance while lockAllMoves is on', async () => {
    h.leagueFindUnique.mockResolvedValue(league({ lockAllMoves: true }))
    h.tradeFindFirst.mockResolvedValue(pendingTrade())
    h.tradeFindUniqueOrThrow.mockResolvedValue(pendingTrade())
    await expect(acceptAfLeagueTrade({ tradeId: 't1', userId: 'ub', leagueId: LEAGUE })).rejects.toThrow(/locked by the commissioner/i)
    expect(h.txUpdateMany).not.toHaveBeenCalled()
  })
})

describe('execution — a delayed trade that would complete after the deadline', () => {
  const due = () => pendingTrade({ status: 'scheduled', scheduledProcessAt: new Date(Date.now() - 60_000) })

  it('control: a due scheduled trade before the deadline is processed', async () => {
    h.tradeFindUniqueOrThrow.mockResolvedValue(due())
    await finalizeAfLeagueTradeProcessing({ tradeId: 't1', actorUserId: 'ub' })
    expect(h.txUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'processed' }) }))
  })

  it('is cancelled, not processed, once the deadline has passed', async () => {
    h.seasonFindFirst.mockResolvedValue({ currentWeek: 9 })
    h.tradeFindUniqueOrThrow.mockResolvedValue(due())
    await expect(finalizeAfLeagueTradeProcessing({ tradeId: 't1', actorUserId: 'ub' })).rejects.toThrow(/trade deadline has passed/i)
    expect(h.txUpdateMany).not.toHaveBeenCalled()
    expect(h.tradeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1', status: 'scheduled' },
        data: expect.objectContaining({ status: 'cancelled' }),
      }),
    )
    expect(h.statusHistory).toHaveBeenCalledWith(expect.objectContaining({ toStatus: 'cancelled', reason: 'trade_deadline_passed' }))
  })

  it('waits (stays scheduled) while lockAllMoves is on — a lock is temporary, a deadline is not', async () => {
    h.leagueFindUnique.mockResolvedValue(league({ lockAllMoves: true }))
    h.tradeFindUniqueOrThrow.mockResolvedValue(due())
    await expect(finalizeAfLeagueTradeProcessing({ tradeId: 't1', actorUserId: 'ub' })).rejects.toThrow(/locked by the commissioner/i)
    expect(h.txUpdateMany).not.toHaveBeenCalled()
    expect(h.tradeUpdateMany).not.toHaveBeenCalled()
  })
})
