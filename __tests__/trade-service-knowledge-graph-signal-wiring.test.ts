/**
 * Confirms lib/league-trade-engine/tradeService.ts calls the new Fantasy
 * Knowledge Graph signal hook (TradeSignalHook.recordTradeOutcomeSignal,
 * mocked here — its own internal correctness is covered by
 * __tests__/shared-services/knowledge-graph/trade-signal-hook.test.ts) at
 * exactly the same real, confirmed transition points already used by the
 * existing Trade Learning capture wiring
 * (__tests__/league-trade-engine-live-capture-wiring.test.ts) — mirrors that
 * file's mocking approach so both wiring layers are verified against the
 * same real transitions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockCaptureLiveTradeOffer,
  mockCaptureLiveTradeOutcome,
  mockRecordTradeOutcomeSignal,
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
  mockRecordTradeOutcomeSignal: vi.fn(),
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

vi.mock('@/lib/shared-services/knowledge-graph/TradeSignalHook', () => ({
  recordTradeOutcomeSignal: mockRecordTradeOutcomeSignal,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique, findUniqueOrThrow: mockLeagueFindUnique },
    redraftSeason: { findFirst: vi.fn().mockResolvedValue(null) },
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
  isPastTradeDeadline: vi.fn().mockReturnValue(false),
  toRedraftProposalGovernance: vi.fn().mockReturnValue({ source: 'persisted_league_settings', processingMode: 'immediate' }),
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
vi.mock('@/lib/events', () => ({
  EVENT: { TRADE_EXECUTED: 'transaction.trade.executed' },
  getPlatformEvents: () => ({ emitInTx: vi.fn().mockResolvedValue({ eventId: 'event-mock' }) }),
}))

import {
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
  return { id: LEAGUE_ID, settings: null, userId: 'commissioner-1' }
}

describe('tradeService Fantasy Knowledge Graph signal wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeagueFindUnique.mockResolvedValue(makeLeague())
    mockCaptureLiveTradeOutcome.mockResolvedValue('outcome-event-1')
    mockRecordTradeOutcomeSignal.mockResolvedValue(undefined)
  })

  it('finalizeAfLeagueTradeProcessing captures a trade_accepted signal after the transaction commits', async () => {
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
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        afLeagueTrade: { update: mockAfLeagueTradeUpdate },
        roster: { findMany: vi.fn().mockResolvedValue([]) },
        iDPSalaryRecord: { findMany: vi.fn().mockResolvedValue([]) },
        redraftSeason: { findFirst: vi.fn().mockResolvedValue(null) },
        tradeExecutionSnapshot: { create: vi.fn().mockResolvedValue({}) },
        leagueAuditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      await cb(tx)
    })

    await finalizeAfLeagueTradeProcessing({ tradeId: 'trade-1', actorUserId: USER_ID })

    expect(mockRecordTradeOutcomeSignal).toHaveBeenCalledWith({
      tradeId: 'trade-1',
      leagueId: LEAGUE_ID,
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      outcome: 'trade_accepted',
      emittedFrom: 'tradeService.finalizeAfLeagueTradeProcessing',
    })
  })

  it('commissionerAfTradeDecision(reject) captures a trade_rejected signal', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({
      id: 'trade-1',
      leagueId: LEAGUE_ID,
      status: 'awaiting_commissioner',
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
    })

    await commissionerAfTradeDecision({ tradeId: 'trade-1', leagueId: LEAGUE_ID, userId: USER_ID, decision: 'reject' })

    expect(mockRecordTradeOutcomeSignal).toHaveBeenCalledWith({
      tradeId: 'trade-1',
      leagueId: LEAGUE_ID,
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      outcome: 'trade_rejected',
      emittedFrom: 'tradeService.commissionerAfTradeDecision',
    })
  })

  it('rejectAfLeagueTrade captures a trade_rejected signal', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({
      id: 'trade-1',
      leagueId: LEAGUE_ID,
      status: 'pending',
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
    })
    mockRosterFindFirst.mockResolvedValue({ id: RECEIVER_ROSTER, platformUserId: USER_ID })

    await rejectAfLeagueTrade({ tradeId: 'trade-1', leagueId: LEAGUE_ID, userId: USER_ID })

    expect(mockRecordTradeOutcomeSignal).toHaveBeenCalledWith({
      tradeId: 'trade-1',
      leagueId: LEAGUE_ID,
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      outcome: 'trade_rejected',
      emittedFrom: 'tradeService.rejectAfLeagueTrade',
    })
  })

  it('cancelAfLeagueTrade captures a trade_cancelled signal', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({
      id: 'trade-1',
      leagueId: LEAGUE_ID,
      status: 'pending',
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
    })
    mockRosterFindFirst.mockResolvedValue({ id: PROPOSER_ROSTER, platformUserId: USER_ID })

    await cancelAfLeagueTrade({ tradeId: 'trade-1', leagueId: LEAGUE_ID, userId: USER_ID })

    expect(mockRecordTradeOutcomeSignal).toHaveBeenCalledWith({
      tradeId: 'trade-1',
      leagueId: LEAGUE_ID,
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      outcome: 'trade_cancelled',
      emittedFrom: 'tradeService.cancelAfLeagueTrade',
    })
  })

  it('castAfTradeVetoVote captures a trade_vetoed signal once the veto threshold is reached', async () => {
    mockAfLeagueTradeFindFirst.mockResolvedValue({
      id: 'trade-1',
      leagueId: LEAGUE_ID,
      status: 'awaiting_votes',
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      vetoThresholdPercent: 50,
    })
    mockRosterFindFirst.mockResolvedValue({ id: 'voter-roster', leagueId: LEAGUE_ID, platformUserId: 'voter-user' })
    mockRosterCount.mockResolvedValue(2)
    mockAfLeagueTradeVoteCount.mockResolvedValue(1)

    await castAfTradeVetoVote({
      tradeId: 'trade-1',
      leagueId: LEAGUE_ID,
      userId: 'voter-user',
      voterRosterId: 'voter-roster',
      vote: 'veto',
    })

    expect(mockRecordTradeOutcomeSignal).toHaveBeenCalledWith({
      tradeId: 'trade-1',
      leagueId: LEAGUE_ID,
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      outcome: 'trade_vetoed',
      emittedFrom: 'tradeService.castAfTradeVetoVote',
    })
  })

  it('does not capture any signal for a mere counter-offer (not an accept/reject/cancel/veto outcome)', async () => {
    mockRosterFindFirst
      .mockResolvedValueOnce({ id: PROPOSER_ROSTER, leagueId: LEAGUE_ID, platformUserId: USER_ID })
      .mockResolvedValueOnce({ id: RECEIVER_ROSTER, leagueId: LEAGUE_ID, platformUserId: 'user-2' })
    mockAfLeagueTradeFindFirst.mockResolvedValue({ id: 'trade-parent', rootTradeId: null, status: 'pending', metadata: {} })
    mockAfLeagueTradeCreate.mockResolvedValue({ id: 'trade-counter' })

    const { createAfLeagueTrade } = await import('@/lib/league-trade-engine/tradeService')
    await createAfLeagueTrade({
      leagueId: LEAGUE_ID,
      proposedByUserId: USER_ID,
      proposerRosterId: PROPOSER_ROSTER,
      receiverRosterId: RECEIVER_ROSTER,
      assets: [{ itemType: 'player', itemReference: 'sleeper-1', fromRosterId: PROPOSER_ROSTER, toRosterId: RECEIVER_ROSTER }],
      parentTradeId: 'trade-parent',
    })

    expect(mockRecordTradeOutcomeSignal).not.toHaveBeenCalled()
  })
})
