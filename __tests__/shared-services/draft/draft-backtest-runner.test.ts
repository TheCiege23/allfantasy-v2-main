import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoricalDraftPickSample } from '@/lib/shared-services/draft/backtest/types'

const {
  mockLeagueFindUnique,
  mockDraftSessionFindUnique,
  mockRosterFindUnique,
  mockDraftPickFindMany,
  mockReadAllFantasyAdpForLeague,
  mockGetRosterTemplate,
  mockGetPlayerPoolForLeague,
  mockEvaluateDraftShadowFromContext,
  mockIsIdpLeague,
} = vi.hoisted(() => ({
  mockLeagueFindUnique: vi.fn(),
  mockDraftSessionFindUnique: vi.fn(),
  mockRosterFindUnique: vi.fn(),
  mockDraftPickFindMany: vi.fn(),
  mockReadAllFantasyAdpForLeague: vi.fn(),
  mockGetRosterTemplate: vi.fn(),
  mockGetPlayerPoolForLeague: vi.fn(),
  mockEvaluateDraftShadowFromContext: vi.fn(),
  mockIsIdpLeague: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique },
    draftSession: { findUnique: mockDraftSessionFindUnique },
    roster: { findUnique: mockRosterFindUnique },
    draftPick: { findMany: mockDraftPickFindMany },
  },
}))
vi.mock('@/lib/adp/readSnapshotForLeague', () => ({ readAllFantasyAdpForLeague: mockReadAllFantasyAdpForLeague }))
vi.mock('@/lib/multi-sport/RosterTemplateService', () => ({ getRosterTemplate: mockGetRosterTemplate }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: mockGetPlayerPoolForLeague }))
vi.mock('@/lib/shared-services/draft/DraftShadowService', () => ({ evaluateDraftShadowFromContext: mockEvaluateDraftShadowFromContext }))
vi.mock('@/lib/idp', () => ({ isIdpLeague: mockIsIdpLeague }))

import { runDraftShadowBacktest } from '@/lib/shared-services/draft/backtest/DraftBacktestRunner'
import { InMemoryDraftShadowResultStore } from '@/lib/shared-services/draft/DraftShadowResultStore'

function makeSample(overrides: Partial<HistoricalDraftPickSample> = {}): HistoricalDraftPickSample {
  return {
    sessionId: 'session-1',
    leagueId: 'league-1',
    platform: 'sleeper',
    overall: 25,
    round: 3,
    rosterId: 'roster-1',
    realPlayerId: 'p1',
    realPlayerName: 'Player One',
    realPosition: 'RB',
    ...overrides,
  }
}

describe('runDraftShadowBacktest', () => {
  let resultStore: InMemoryDraftShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryDraftShadowResultStore()
    mockLeagueFindUnique.mockResolvedValue({ sport: 'NFL', platform: 'sleeper', isDynasty: false, settings: {} })
    mockDraftSessionFindUnique.mockResolvedValue({ teamCount: 12, status: 'completed', draftType: 'snake', devyConfig: null })
    mockRosterFindUnique.mockResolvedValue({ platformUserId: 'manager-1' })
    mockDraftPickFindMany.mockResolvedValue([])
    mockReadAllFantasyAdpForLeague.mockResolvedValue({ entries: [], totalDrafts: 0, computedAt: null, contextHash: '', draftMode: 'real' })
    mockGetRosterTemplate.mockResolvedValue({ templateId: 't1', sportType: 'NFL', name: 'x', formatType: 'standard', slots: [] })
    mockGetPlayerPoolForLeague.mockResolvedValue([])
    mockIsIdpLeague.mockResolvedValue(false)
  })

  it('reconstructs a point-in-time context (picks before this overall only) and evaluates it', async () => {
    mockEvaluateDraftShadowFromContext.mockResolvedValue({ evaluationId: 'eval-1' })
    const sample = makeSample()

    await runDraftShadowBacktest([sample], { resultStore })

    expect(mockDraftPickFindMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-1', overall: { lt: 25 } },
      select: { rosterId: true, position: true, team: true, byeWeek: true, playerName: true },
    })
    expect(mockEvaluateDraftShadowFromContext).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-1', rosterId: 'roster-1', round: 3, pick: 25 }),
      resultStore
    )
  })

  it('returns paired sample+evaluation results for successful samples', async () => {
    const evaluation = { evaluationId: 'eval-1' }
    mockEvaluateDraftShadowFromContext.mockResolvedValue(evaluation)
    const sample = makeSample()

    const summary = await runDraftShadowBacktest([sample], { resultStore })

    expect(summary.totalSamples).toBe(1)
    expect(summary.evaluatedCount).toBe(1)
    expect(summary.pairs).toEqual([{ sample, evaluation }])
  })

  it('isolates a single sample failure — the rest of the batch still evaluates', async () => {
    mockEvaluateDraftShadowFromContext.mockResolvedValue({ evaluationId: 'eval-1' })
    mockLeagueFindUnique.mockResolvedValueOnce({ sport: 'NFL', platform: 'sleeper', isDynasty: false, settings: {} }).mockResolvedValueOnce(null)
    const onSampleError = vi.fn()

    const summary = await runDraftShadowBacktest(
      [makeSample({ overall: 25 }), makeSample({ overall: 37, sessionId: 'session-2' })],
      { resultStore, onSampleError }
    )

    expect(summary.evaluatedCount).toBe(1)
    expect(summary.failedCount).toBe(1)
    expect(summary.failures).toEqual([{ sessionId: 'session-2', overall: 37, error: 'League not found: league-1' }])
    expect(onSampleError).toHaveBeenCalledTimes(1)
  })

  it('handles an empty sample corpus cleanly', async () => {
    const summary = await runDraftShadowBacktest([], { resultStore })
    expect(summary).toEqual({ totalSamples: 0, evaluatedCount: 0, failedCount: 0, failures: [], evaluations: [], pairs: [] })
    expect(mockEvaluateDraftShadowFromContext).not.toHaveBeenCalled()
  })
})
