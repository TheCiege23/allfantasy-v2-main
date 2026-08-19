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
    },
    afLeagueTradeVote: { upsert: mockAfLeagueTradeVoteUpsert, count: mockAfLeagueTradeVoteCount },
    $transaction: mockTransaction,
  },
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
      const tx = { afLeagueTrade: { update: mockAfLeagueTradeUpdate } }
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
