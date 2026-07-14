/**
 * Confirms lib/waiver-wire/process-engine.ts's processWaiverClaimsForLeague
 * calls the new Fantasy Knowledge Graph signal hook
 * (WaiverSignalHook.recordWaiverClaimSignal, mocked here — its own internal
 * correctness is covered by
 * __tests__/shared-services/knowledge-graph/waiver-signal-hook.test.ts) at
 * both real resolution paths: a successful award, and a failure routed
 * through the shared `pushFail` helper. No prior test exercised this
 * function directly, so every dependency is mocked from a fresh read of the
 * real source (lib/waiver-wire/process-engine.ts) rather than assumed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockRecordWaiverClaimSignal,
  mockGetEffectiveLeagueWaiverSettings,
  mockOnWaiverRunComplete,
  mockGetSpecialtySpecByVariant,
  mockIsWaiverFrozenForRoster,
  mockCommissionerOverrideAllowed,
  mockGetCommissionerOverrides,
  mockRecordAfLearningEvent,
  mockResolveLeagueSport,
  mockUpsertLeagueWaiverStateAfterRun,
  mockGetLeagueWaiverState,
  mockRecordProductEvent,
  mockLeagueFindUnique,
  mockWaiverClaimFindMany,
  mockWaiverClaimUpdate,
  mockRosterFindMany,
  mockRosterFindUnique,
  mockRosterUpdate,
  mockLeagueTeamFindMany,
  mockWaiverRunCreate,
  mockWaiverRunUpdate,
  mockWaiverTransactionCreate,
  mockWaiverResultCreateMany,
  mockTransaction,
} = vi.hoisted(() => ({
  mockRecordWaiverClaimSignal: vi.fn(),
  mockGetEffectiveLeagueWaiverSettings: vi.fn(),
  mockOnWaiverRunComplete: vi.fn().mockResolvedValue(undefined),
  mockGetSpecialtySpecByVariant: vi.fn().mockReturnValue(null),
  mockIsWaiverFrozenForRoster: vi.fn().mockResolvedValue(false),
  mockCommissionerOverrideAllowed: vi.fn().mockReturnValue(false),
  mockGetCommissionerOverrides: vi.fn().mockReturnValue({}),
  mockRecordAfLearningEvent: vi.fn().mockResolvedValue(undefined),
  mockResolveLeagueSport: vi.fn().mockResolvedValue('nfl'),
  mockUpsertLeagueWaiverStateAfterRun: vi.fn().mockResolvedValue(undefined),
  mockGetLeagueWaiverState: vi.fn().mockResolvedValue(null),
  mockRecordProductEvent: vi.fn(),
  mockLeagueFindUnique: vi.fn(),
  mockWaiverClaimFindMany: vi.fn(),
  mockWaiverClaimUpdate: vi.fn().mockResolvedValue(undefined),
  mockRosterFindMany: vi.fn(),
  mockRosterFindUnique: vi.fn(),
  mockRosterUpdate: vi.fn().mockResolvedValue(undefined),
  mockLeagueTeamFindMany: vi.fn().mockResolvedValue([]),
  mockWaiverRunCreate: vi.fn(),
  mockWaiverRunUpdate: vi.fn().mockResolvedValue(undefined),
  mockWaiverTransactionCreate: vi.fn().mockResolvedValue(undefined),
  mockWaiverResultCreateMany: vi.fn().mockResolvedValue(undefined),
  mockTransaction: vi.fn(),
}))

vi.mock('@/lib/shared-services/knowledge-graph/WaiverSignalHook', () => ({
  recordWaiverClaimSignal: mockRecordWaiverClaimSignal,
}))
vi.mock('./settings-service', () => ({ getEffectiveLeagueWaiverSettings: mockGetEffectiveLeagueWaiverSettings }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: mockGetEffectiveLeagueWaiverSettings }))
vi.mock('./run-hooks', () => ({ onWaiverRunComplete: mockOnWaiverRunComplete }))
vi.mock('@/lib/waiver-wire/run-hooks', () => ({ onWaiverRunComplete: mockOnWaiverRunComplete }))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: mockGetSpecialtySpecByVariant }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ isWaiverFrozenForRoster: mockIsWaiverFrozenForRoster }))
vi.mock('./commissioner-claim-override', () => ({
  commissionerOverrideAllowed: mockCommissionerOverrideAllowed,
  getCommissionerOverrides: mockGetCommissionerOverrides,
}))
vi.mock('@/lib/waiver-wire/commissioner-claim-override', () => ({
  commissionerOverrideAllowed: mockCommissionerOverrideAllowed,
  getCommissionerOverrides: mockGetCommissionerOverrides,
}))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: mockRecordAfLearningEvent }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: mockResolveLeagueSport }))
vi.mock('./waiver-state-service', () => ({
  upsertLeagueWaiverStateAfterRun: mockUpsertLeagueWaiverStateAfterRun,
  getLeagueWaiverState: mockGetLeagueWaiverState,
}))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({
  upsertLeagueWaiverStateAfterRun: mockUpsertLeagueWaiverStateAfterRun,
  getLeagueWaiverState: mockGetLeagueWaiverState,
}))
vi.mock('@/lib/engine-testing/hardening/engineInvariants', () => ({
  assertNonEmptyIdempotencyKey: vi.fn().mockReturnValue(true),
}))
vi.mock('@/lib/engine-testing/runtime/invariantRuntime', () => ({ logEngineInvariantOptional: vi.fn() }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: mockRecordProductEvent }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waiverRun: { findMany: vi.fn().mockResolvedValue([]), create: mockWaiverRunCreate, update: mockWaiverRunUpdate },
    league: { findUnique: mockLeagueFindUnique },
    waiverClaim: { findMany: mockWaiverClaimFindMany, update: mockWaiverClaimUpdate },
    roster: { findMany: mockRosterFindMany, findUnique: mockRosterFindUnique, update: mockRosterUpdate },
    leagueTeam: { findMany: mockLeagueTeamFindMany },
    waiverTransaction: { create: mockWaiverTransactionCreate },
    waiverResult: { createMany: mockWaiverResultCreateMany },
    $transaction: mockTransaction,
  },
}))

import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'

const LEAGUE_ID = 'league-1'

function baseSettings() {
  return {
    normalizedWaiverType: 'priority',
    waiverType: 'priority',
    tiebreakRule: 'priority_lowest_first',
    faabMinBid: 0,
    allowZeroFaabBid: true,
    waiverEngineConfig: {},
    commissionerOverrideRules: null,
    processingDayOfWeek: null,
    processingTimeUtc: null,
    processingDays: null,
  }
}

describe('processWaiverClaimsForLeague Fantasy Knowledge Graph signal wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetEffectiveLeagueWaiverSettings.mockResolvedValue(baseSettings())
    mockGetLeagueWaiverState.mockResolvedValue(null)
    mockLeagueFindUnique.mockResolvedValue({ id: LEAGUE_ID, rosterSize: 20, leagueVariant: null, sport: 'nfl' })
    mockWaiverRunCreate.mockResolvedValue({ id: 'run-1' })
    mockRosterFindMany.mockResolvedValue([])
    mockLeagueTeamFindMany.mockResolvedValue([])
  })

  it('captures a waiver_claim_won signal for a successfully awarded claim', async () => {
    const claim = {
      id: 'claim-1',
      leagueId: LEAGUE_ID,
      rosterId: 'roster-1',
      addPlayerId: 'player-add',
      dropPlayerId: null,
      faabBid: 0,
      priorityOrder: 1,
      status: 'pending',
      metadata: {},
      roster: { id: 'roster-1', platformUserId: 'user-1', playerData: { players: [] }, faabRemaining: 100, waiverPriority: 1 },
    }
    mockWaiverClaimFindMany.mockResolvedValue([claim])
    mockRosterFindMany.mockResolvedValue([{ id: 'roster-1', playerData: { players: [] }, waiverPriority: 1, faabRemaining: 100 }])
    mockRosterFindUnique.mockResolvedValue({ faabRemaining: 100, waiverPriority: 1, playerData: { players: ['player-add'] } })

    await processWaiverClaimsForLeague(LEAGUE_ID)

    expect(mockRecordWaiverClaimSignal).toHaveBeenCalledWith({
      outcome: 'waiver_claim_won',
      leagueId: LEAGUE_ID,
      managerKey: 'user-1',
      claimId: 'claim-1',
      addPlayerId: 'player-add',
      dropPlayerId: null,
      emittedFrom: 'process-engine.processWaiverClaimsForLeague',
    })
  })

  it('captures a waiver_claim_lost signal when a claim fails (player no longer available)', async () => {
    const claim = {
      id: 'claim-2',
      leagueId: LEAGUE_ID,
      rosterId: 'roster-2',
      addPlayerId: 'player-taken',
      dropPlayerId: null,
      faabBid: 0,
      priorityOrder: 1,
      status: 'pending',
      metadata: {},
      roster: { id: 'roster-2', platformUserId: 'user-2', playerData: { players: [] }, faabRemaining: 100, waiverPriority: 2 },
    }
    mockWaiverClaimFindMany.mockResolvedValue([claim])
    // Another roster already carries the contested player, forcing the "no longer available" failure branch.
    mockRosterFindMany.mockResolvedValue([
      { id: 'roster-other', playerData: { players: ['player-taken'] }, waiverPriority: 1, faabRemaining: 100 },
      { id: 'roster-2', playerData: { players: [] }, waiverPriority: 2, faabRemaining: 100 },
    ])

    await processWaiverClaimsForLeague(LEAGUE_ID)

    expect(mockRecordWaiverClaimSignal).toHaveBeenCalledWith({
      outcome: 'waiver_claim_lost',
      leagueId: LEAGUE_ID,
      managerKey: 'user-2',
      claimId: 'claim-2',
      addPlayerId: 'player-taken',
      dropPlayerId: null,
      emittedFrom: 'process-engine.pushFail',
    })
  })
})
