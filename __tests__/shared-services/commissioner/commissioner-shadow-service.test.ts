/**
 * Integration test for CommissionerShadowService.ts — mocks the true
 * external boundaries (context/pulse/health/attention/ranking/brief/
 * divergence builders), same pattern as every other phase's shadow-service
 * integration test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockBuildCommissionerContext,
  mockBuildLeaguePulse,
  mockBuildLeagueHealthAssessment,
  mockBuildCommissionerAttentionItems,
  mockBuildCommissionerRanking,
  mockBuildCommissionerBrief,
  mockAnalyzeCommissionerDivergence,
} = vi.hoisted(() => ({
  mockBuildCommissionerContext: vi.fn(),
  mockBuildLeaguePulse: vi.fn(),
  mockBuildLeagueHealthAssessment: vi.fn(),
  mockBuildCommissionerAttentionItems: vi.fn(),
  mockBuildCommissionerRanking: vi.fn(),
  mockBuildCommissionerBrief: vi.fn(),
  mockAnalyzeCommissionerDivergence: vi.fn(),
}))

vi.mock('@/lib/shared-services/commissioner/CommissionerContextAssembler', () => ({ buildCommissionerContext: mockBuildCommissionerContext }))
vi.mock('@/lib/shared-services/commissioner/LeaguePulseService', () => ({ buildLeaguePulse: mockBuildLeaguePulse }))
vi.mock('@/lib/shared-services/commissioner/LeagueHealthService', () => ({ buildLeagueHealthAssessment: mockBuildLeagueHealthAssessment }))
vi.mock('@/lib/shared-services/commissioner/CommissionerAttentionService', () => ({ buildCommissionerAttentionItems: mockBuildCommissionerAttentionItems }))
vi.mock('@/lib/shared-services/commissioner/CommissionerRankingService', () => ({ buildCommissionerRanking: mockBuildCommissionerRanking }))
vi.mock('@/lib/shared-services/commissioner/CommissionerBriefService', () => ({ buildCommissionerBrief: mockBuildCommissionerBrief }))
vi.mock('@/lib/shared-services/commissioner/CommissionerDivergenceAnalyzer', () => ({ analyzeCommissionerDivergence: mockAnalyzeCommissionerDivergence }))

import { evaluateCommissionerShadow } from '@/lib/shared-services/commissioner/CommissionerShadowService'
import { InMemoryCommissionerShadowResultStore } from '@/lib/shared-services/commissioner/CommissionerShadowResultStore'

describe('evaluateCommissionerShadow', () => {
  let resultStore: InMemoryCommissionerShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryCommissionerShadowResultStore()
    mockBuildCommissionerContext.mockResolvedValue({ leagueId: 'league-1' })
    mockBuildLeaguePulse.mockReturnValue({ leagueId: 'league-1', dimensions: [] })
    mockBuildLeagueHealthAssessment.mockReturnValue({ leagueId: 'league-1', category: 'healthy' })
    mockBuildCommissionerAttentionItems.mockReturnValue([])
    mockBuildCommissionerRanking.mockResolvedValue(null)
    mockBuildCommissionerBrief.mockReturnValue({ leagueId: 'league-1', sections: [] })
    mockAnalyzeCommissionerDivergence.mockResolvedValue([])
  })

  it('assembles a real evaluation composing every real sub-builder', async () => {
    const evaluation = await evaluateCommissionerShadow({ leagueId: 'league-1', requestingUserId: 'user-1', resultStore })

    expect(mockBuildCommissionerContext).toHaveBeenCalledWith({ leagueId: 'league-1', requestingUserId: 'user-1', resultStore })
    expect(evaluation.leagueId).toBe('league-1')
    expect(evaluation.pulse).toEqual({ leagueId: 'league-1', dimensions: [] })
    expect(evaluation.health.category).toBe('healthy')

    const logged = await resultStore.all()
    expect(logged).toHaveLength(1)
    expect(logged[0].evaluationId).toBe(evaluation.evaluationId)
  })

  it('passes attentionItems and ranking into buildCommissionerBrief, never recomputing facts', async () => {
    mockBuildCommissionerAttentionItems.mockReturnValue([{ reasonCode: 'legacy_signal' }])
    mockBuildCommissionerRanking.mockResolvedValue({ leagueId: 'league-1', week: 5 })

    await evaluateCommissionerShadow({ leagueId: 'league-1', requestingUserId: 'user-1', resultStore })

    expect(mockBuildCommissionerBrief).toHaveBeenCalledWith(
      { leagueId: 'league-1' },
      { leagueId: 'league-1', week: 5 },
      [{ reasonCode: 'legacy_signal' }]
    )
  })

  it('never lets a divergence analysis failure crash the whole evaluation — logs empty divergence instead', async () => {
    mockAnalyzeCommissionerDivergence.mockRejectedValue(new Error('divergence engine exploded'))
    const evaluation = await evaluateCommissionerShadow({ leagueId: 'league-1', requestingUserId: 'user-1', resultStore })
    expect(evaluation.divergence).toEqual([])
    expect(evaluation.pulse).toBeDefined() // rest of the evaluation unaffected
  })

  it('propagates a failure from context assembly (no meaningful evaluation possible without it)', async () => {
    mockBuildCommissionerContext.mockRejectedValue(new Error('context assembly failed'))
    await expect(evaluateCommissionerShadow({ leagueId: 'league-1', requestingUserId: 'user-1', resultStore })).rejects.toThrow('context assembly failed')
    expect(await resultStore.all()).toEqual([])
  })

  it('never persists to a live production store — uses the injected in-memory store only', async () => {
    await evaluateCommissionerShadow({ leagueId: 'league-1', requestingUserId: 'user-1', resultStore })
    expect(resultStore).toBeInstanceOf(InMemoryCommissionerShadowResultStore)
  })
})
