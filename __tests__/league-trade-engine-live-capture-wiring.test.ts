/**
 * Decision OS — Trade Learning Phase 8 (Implement Live Capture Architecture).
 *
 * Confirms lib/league-trade-engine/tradeService.ts calls the Phase 8 capture
 * functions (mocked here — their own internal correctness is covered by
 * __tests__/trade-engine/trade-learning-capture.test.ts) at exactly the
 * real, confirmed transition points: create (+ counter-parent update),
 * finalize/processed, commissioner-reject, direct-reject, cancel, and
 * veto-threshold. Every other tradeService dependency is mocked with a
 * permissive pass-through so each flow reaches its real transition point
 * without re-testing tradeService's own pre-existing business logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockCaptureLiveTradeOffer,
  mockCaptureLiveTradeOutcome,
  mockLeagueFindUnique,
  mockRosterFindFirst,
  mockRosterFindUnique,
  mockAfLeagueTradeCreate,
  mockAfLeagueTradeFindFirst,
  mockAfLeagueTradeFindUniqueOrThrow,
  mockAfLeagueTradeUpdate,
  mockAfLeagueTradeUpdateMany,
  mockSnapshotCreate,
  mockTxRosterFindUnique,
  mockEmitInTx,
  mockAfLeagueTradeVoteUpsert,
  mockAfLeagueTradeVoteCount,
  mockRosterCount,
  mockTransaction,
} = vi.hoisted(() => ({
  mockCaptureLiveTradeOffer: vi.fn(),
  mockCaptureLiveTradeOutcome: vi.fn(),
  mockLeagueFindUnique: vi.fn(),
  mockRosterFindFirst: vi.fn(),
  mockRosterFindUnique: vi.fn(),
  mockAfLeagueTradeCreate: vi.fn(),
  mockAfLeagueTradeFindFirst: vi.fn(),
  mockAfLeagueTradeFindUniqueOrThrow: vi.fn(),
  mockAfLeagueTradeUpdate: vi.fn(),
  mockAfLeagueTradeUpdateMany: vi.fn(),
  mockSnapshotCreate: vi.fn(),
  mockTxRosterFindUnique: vi.fn(),
  mockEmitInTx: vi.fn(),
  mockAfLeagueTradeVoteUpsert: vi.fn(),
  mockAfLeagueTradeVoteCount: vi.fn(),
  mockRosterCount: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: mockCaptureLiveTradeOffer,
  captureLiveTradeOutcome: mockCaptureLiveTradeOutcome,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique, findUniqueOrThrow: mockLeagueFindUnique },
    roster: { findFirst: mockRosterFindFirst, findUnique: mockRosterFindUnique, count: mockRosterCount },
    afLeagueTrade: {
      create: mockAfLeagueTradeCreate,
      findFirst: mockAfLeagueTradeFindFirst,
      findUniqueOrThrow: mockAfLeagueTradeFindUniqueOrThrow,
      update: mockAfLeagueTradeUpdate,
      updateMany: mockAfLeagueTradeUpdateMany,
    },
    afLeagueTradeVote: { upsert: mockAfLeagueTradeVoteUpsert, count: mockAfLeagueTradeVoteCount },
    $transaction: mockTransaction,
  },
}))

/*
 * ⚠ THE EXECUTION SNAPSHOT EMITS ITS OUTBOX EVENT WITH `emitInTx`, WHICH PROPAGATES. The real
 * publisher reaching for an outbox delegate this double does not have would fail the settlement
 * transaction and turn every test here red for a reason unrelated to what they assert.
 */
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_PROCESSED: 'transaction.trade.processed' },
  getPlatformEvents: () => ({ emitInTx: mockEmitInTx }),
}))

vi.mock('@/server/services/leagueLifecycleService', () => ({
  assertLifecycleActionAllowed: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/league-trade-engine/tradeValidationService', () => ({
  validateTradeAssets: vi.fn().mockReturnValue({ ok: true }),
}))

vi.mock('@/lib/league-trade-engine/tradeSettingsResolver', () => ({
  resolveLeagueTradeSettings: vi.fn().mockReturnValue({
    tradeReviewMode: 'instant',
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

vi.mock('@/lib/league-trade-engine/tradeProcessor', () => ({
  applyTradeAssetsInTransaction: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn().mockResolvedValue(undefined),
  appendAfTradeStatusHistory: vi.fn().mockResolvedValue(undefined),
  logAfTradeAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({
  assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({
  recordProductEvent: vi.fn(),
}))

vi.mock('@/lib/league-events/publisher', () => ({
  publishLeagueFanoutEvent: vi.fn().mockResolvedValue(undefined),
}))

import {
  createAfLeagueTrade,
  finalizeAfLeagueTradeProcessing,
  commissionerAfTradeDecision,
  rejectAfLeagueTrade,
  cancelAfLeagueTrade,
  castAfTradeVetoVote,
} from '@/lib/league-trade-engine/tradeService'

const LEAGUE_ID = 'league-1'
const PROPOSER_ROSTER = 'roster-proposer'
const RECEIVER_ROSTER = 'roster-receiver'
const USER_ID = 'user-1'

function makeLeague() {
  return { id: LEAGUE_ID, settings: null }
}

function makeRoster(id: string, userId: string) {
  return { id, leagueId: LEAGUE_ID, platformUserId: userId }
}

describe('tradeService live capture wiring (Trade Learning Phase 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeagueFindUnique.mockResolvedValue(makeLeague())
    mockCaptureLiveTradeOffer.mockResolvedValue('offer-event-1')
    mockCaptureLiveTradeOutcome.mockResolvedValue('outcome-event-1')
    // The settlement transaction opens with a conditional claim; by default it succeeds.
    mockAfLeagueTradeUpdateMany.mockResolvedValue({ count: 1 })
    mockEmitInTx.mockResolvedValue({ eventId: 'evt-live-1' })
    mockSnapshotCreate.mockResolvedValue({ id: 'snap-live-1' })
    mockTxRosterFindUnique.mockResolvedValue(null)
  })

  it('createAfLeagueTrade captures a live offer exactly once, with the real trade id and assets', async () => {
    mockRosterFindFirst
      .mockResolvedValueOnce(makeRoster(PROPOSER_ROSTER, USER_ID))
      .mockResolvedValueOnce(makeRoster(RECEIVER_ROSTER, 'user-2'))
    mockAfLeagueTradeCreate.mockResolvedValue({ id: 'trade-1' })

    const { id } = await createAfLeagueTrade({
      leagueId: LEAGUE_ID,
      proposedByUserId: USER_ID,
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      assets: [{ itemType: 'player', itemReference: 'sleeper-1', fromRosterId: PROPOSER_ROSTER, toRosterId: RECEIVER_ROSTER }],
    })

    expect(id).toBe('trade-1')
    expect(mockCaptureLiveTradeOffer).toHaveBeenCalledTimes(1)
    expect(mockCaptureLiveTradeOffer).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: 'trade-1',
        leagueId: LEAGUE_ID,
        proposerRosterId: PROPOSER_ROSTER,
        receiverRosterId: RECEIVER_ROSTER,
      }),
    )
    expect(mockCaptureLiveTradeOutcome).not.toHaveBeenCalled()
  })

  it('a counter-offer captures COUNTERED for the parent trade, in addition to a fresh offer for the new one', async () => {
    mockRosterFindFirst
      .mockResolvedValueOnce(makeRoster(PROPOSER_ROSTER, USER_ID))
      .mockResolvedValueOnce(makeRoster(RECEIVER_ROSTER, 'user-2'))
    mockAfLeagueTradeFindFirst.mockResolvedValue({ id: 'trade-parent', rootTradeId: null, status: 'pending', metadata: {} })
    mockAfLeagueTradeCreate.mockResolvedValue({ id: 'trade-counter' })

    await createAfLeagueTrade({
      leagueId: LEAGUE_ID,
      proposedByUserId: USER_ID,
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      assets: [{ itemType: 'player', itemReference: 'sleeper-1', fromRosterId: PROPOSER_ROSTER, toRosterId: RECEIVER_ROSTER }],
      parentTradeId: 'trade-parent',
    })

    expect(mockCaptureLiveTradeOffer).toHaveBeenCalledWith(expect.objectContaining({ tradeId: 'trade-counter' }))
    expect(mockCaptureLiveTradeOutcome).toHaveBeenCalledWith({
      tradeId: 'trade-parent',
      leagueId: LEAGUE_ID,
      status: 'countered',
    })
  })

  it('finalizeAfLeagueTradeProcessing captures ACCEPTED after the transaction commits, not inside it', async () => {
    mockAfLeagueTradeFindUniqueOrThrow.mockResolvedValue({
      id: 'trade-1',
      leagueId: LEAGUE_ID,
      status: 'pending',
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      processingDelayHours: 0,
      scheduledProcessAt: null,
      items: [],
    })
    let capturedCalledDuringTransaction = false
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      // `updateMany` is the CONDITIONAL CLAIM the settlement transaction now opens with; a tx
      // double without it throws before the assertion this test is actually about.
      const tx = {
        afLeagueTrade: { update: mockAfLeagueTradeUpdate, updateMany: mockAfLeagueTradeUpdateMany },
        // Read + written by the execution snapshot, on this same tx.
        roster: { findUnique: mockTxRosterFindUnique },
        tradeExecutionSnapshot: { create: mockSnapshotCreate },
      }
      await cb(tx)
      capturedCalledDuringTransaction = mockCaptureLiveTradeOutcome.mock.calls.length > 0
    })

    await finalizeAfLeagueTradeProcessing({ tradeId: 'trade-1', actorUserId: USER_ID })

    expect(capturedCalledDuringTransaction).toBe(false) // not yet called inside the transaction callback
    expect(mockCaptureLiveTradeOutcome).toHaveBeenCalledWith({
      tradeId: 'trade-1',
      leagueId: LEAGUE_ID,
      status: 'processed',
    })
  })

  /*
   * 🛑 THE SETTLEMENT CLAIM. `finalizeAfLeagueTradeProcessing` used to write `processed` with a
   * bare `update({ where: { id } })` placed AFTER the asset move, so two concurrent finalizers
   * each applied the assets and each marked it processed — assets twice, one row to show for it.
   * It took two humans acting at once until `processDueScheduledTrades` began sweeping due trades
   * on a schedule; a cron running beside a manager pressing "process" makes it ordinary.
   */
  function processableTrade() {
    mockAfLeagueTradeFindUniqueOrThrow.mockResolvedValue({
      id: 'trade-1',
      leagueId: LEAGUE_ID,
      status: 'pending',
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      processingDelayHours: 0,
      scheduledProcessAt: null,
      items: [],
    })
  }

  it('claims the trade on the status it read, before any asset moves', async () => {
    processableTrade()
    const order: string[] = []
    mockAfLeagueTradeUpdateMany.mockImplementation(async () => {
      order.push('claim')
      return { count: 1 }
    })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        afLeagueTrade: { update: mockAfLeagueTradeUpdate, updateMany: mockAfLeagueTradeUpdateMany },
        // Read + written by the execution snapshot, on this same tx.
        roster: { findUnique: mockTxRosterFindUnique },
        tradeExecutionSnapshot: { create: mockSnapshotCreate },
      })
    })

    await finalizeAfLeagueTradeProcessing({ tradeId: 'trade-1', actorUserId: USER_ID })

    // Conditional on the status READ — an unconditional `where: { id }` cannot lose a race.
    expect(mockAfLeagueTradeUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockAfLeagueTradeUpdateMany.mock.calls[0][0].where).toEqual({ id: 'trade-1', status: 'pending' })
    expect(order[0]).toBe('claim')

    // Execution evidence is written on the SAME transaction, with the generic FK filled and the
    // native one left alone — both are unique nullable FKs to different tables.
    expect(mockSnapshotCreate).toHaveBeenCalledTimes(1)
    expect(mockSnapshotCreate.mock.calls[0][0].data.genericTradeId).toBe('trade-1')
    expect(mockSnapshotCreate.mock.calls[0][0].data.nativeTradeId).toBeUndefined()
    expect(mockSnapshotCreate.mock.calls[0][0].data.executedByActorRole).toBe('user')
    expect(mockEmitInTx).toHaveBeenCalledTimes(1)
  })

  it('throws instead of settling twice when the claim finds the trade already taken', async () => {
    processableTrade()
    mockAfLeagueTradeUpdateMany.mockResolvedValue({ count: 0 })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      await cb({
        afLeagueTrade: { update: mockAfLeagueTradeUpdate, updateMany: mockAfLeagueTradeUpdateMany },
        // Read + written by the execution snapshot, on this same tx.
        roster: { findUnique: mockTxRosterFindUnique },
        tradeExecutionSnapshot: { create: mockSnapshotCreate },
      })
    })

    await expect(
      finalizeAfLeagueTradeProcessing({ tradeId: 'trade-1', actorUserId: USER_ID }),
    ).rejects.toThrow('TRADE_ALREADY_PROCESSED')

    // The loser must not report a successful settlement to the learning capture either.
    expect(mockCaptureLiveTradeOutcome).not.toHaveBeenCalled()
  })

  it('commissionerAfTradeDecision(reject) captures REJECTED', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({ id: 'trade-1', status: 'awaiting_commissioner' })

    await commissionerAfTradeDecision({ tradeId: 'trade-1', leagueId: LEAGUE_ID, userId: USER_ID, decision: 'reject' })

    expect(mockCaptureLiveTradeOutcome).toHaveBeenCalledWith({ tradeId: 'trade-1', leagueId: LEAGUE_ID, status: 'rejected' })
  })

  it('rejectAfLeagueTrade captures REJECTED', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({ id: 'trade-1', status: 'pending', receiverRosterId: RECEIVER_ROSTER })
    mockRosterFindFirst.mockResolvedValueOnce(makeRoster(RECEIVER_ROSTER, USER_ID))

    await rejectAfLeagueTrade({ tradeId: 'trade-1', leagueId: LEAGUE_ID, userId: USER_ID })

    expect(mockCaptureLiveTradeOutcome).toHaveBeenCalledWith({ tradeId: 'trade-1', leagueId: LEAGUE_ID, status: 'rejected' })
  })

  it('cancelAfLeagueTrade captures a status of "cancelled" (mapped to UNKNOWN inside the capture module, not here)', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({ id: 'trade-1', status: 'pending', proposerRosterId: PROPOSER_ROSTER })
    mockRosterFindFirst.mockResolvedValueOnce(makeRoster(PROPOSER_ROSTER, USER_ID))

    await cancelAfLeagueTrade({ tradeId: 'trade-1', leagueId: LEAGUE_ID, userId: USER_ID })

    expect(mockCaptureLiveTradeOutcome).toHaveBeenCalledWith({ tradeId: 'trade-1', leagueId: LEAGUE_ID, status: 'cancelled' })
  })

  it('castAfTradeVetoVote captures a status of "vetoed" once the threshold is met, not before', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({
      id: 'trade-1', status: 'awaiting_votes', proposerRosterId: PROPOSER_ROSTER, receiverRosterId: RECEIVER_ROSTER, vetoThresholdPercent: 50,
    })
    mockRosterFindFirst.mockResolvedValueOnce({ id: 'roster-voter', leagueId: LEAGUE_ID, platformUserId: USER_ID })
    mockRosterCount.mockResolvedValue(2) // 2 rosters in league, 50% threshold -> 1 veto needed
    mockAfLeagueTradeVoteCount.mockResolvedValue(1)

    await castAfTradeVetoVote({
      tradeId: 'trade-1', leagueId: LEAGUE_ID, userId: USER_ID, voterRosterId: 'roster-voter', vote: 'veto',
    })

    expect(mockCaptureLiveTradeOutcome).toHaveBeenCalledWith({ tradeId: 'trade-1', leagueId: LEAGUE_ID, status: 'vetoed' })
  })

  it('castAfTradeVetoVote does NOT capture an outcome when the veto threshold has not yet been met', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({
      id: 'trade-1', status: 'awaiting_votes', proposerRosterId: PROPOSER_ROSTER, receiverRosterId: RECEIVER_ROSTER, vetoThresholdPercent: 50,
    })
    mockRosterFindFirst.mockResolvedValueOnce({ id: 'roster-voter', leagueId: LEAGUE_ID, platformUserId: USER_ID })
    mockRosterCount.mockResolvedValue(10) // 50% of 10 = 5 needed
    mockAfLeagueTradeVoteCount.mockResolvedValue(1) // only 1 so far

    await castAfTradeVetoVote({
      tradeId: 'trade-1', leagueId: LEAGUE_ID, userId: USER_ID, voterRosterId: 'roster-voter', vote: 'veto',
    })

    expect(mockCaptureLiveTradeOutcome).not.toHaveBeenCalled()
  })
})
