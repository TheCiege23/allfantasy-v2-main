import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateWaiverRecommendations } = vi.hoisted(() => ({ mockGenerateWaiverRecommendations: vi.fn() }))

vi.mock('@/lib/ai/waivers/waiverRecommendationService', () => ({
  generateWaiverRecommendations: mockGenerateWaiverRecommendations,
}))

import { runLegacyWaiverGrader } from '@/lib/shared-services/waiver/WaiverRecommendationAdapter'

describe('runLegacyWaiverGrader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an unavailable result honestly when no manager key exists', async () => {
    const result = await runLegacyWaiverGrader({ leagueId: 'league-1', managerKey: null })
    expect(result).toEqual({
      graderId: 'waiver_recommendation_service',
      topAddPlayerId: null,
      topAddPlayerName: null,
      faabBid: null,
      priority: null,
      confidence: null,
      error: 'No manager identifier available for this roster.',
    })
    expect(mockGenerateWaiverRecommendations).not.toHaveBeenCalled()
  })

  it('maps the real top recommendation into a LegacyWaiverGraderResult', async () => {
    mockGenerateWaiverRecommendations.mockResolvedValue({
      recommendations: [
        { addPlayerId: 'p1', addPlayerName: 'Player One', dropPlayerId: null, dropPlayerName: null, priority: 1, suggestedFaabBid: 12, confidence: 'medium', risk: 'low', reasoning: 'r', deeperAnalysisPath: '', tags: [] },
      ],
      rosterNeeds: [],
      leagueContext: { leagueId: 'league-1', waiverType: 'faab', faabBudget: 100, faabRemaining: 80 },
      generatedAt: new Date().toISOString(),
    })

    const result = await runLegacyWaiverGrader({ leagueId: 'league-1', managerKey: 'manager-1' })

    expect(mockGenerateWaiverRecommendations).toHaveBeenCalledWith({ userId: 'manager-1', leagueId: 'league-1', mode: 'quick', includeFaab: true })
    expect(result).toEqual({
      graderId: 'waiver_recommendation_service',
      topAddPlayerId: 'p1',
      topAddPlayerName: 'Player One',
      faabBid: 12,
      priority: 1,
      confidence: 'medium',
      error: null,
    })
  })

  it('honestly reports no recommendation when the legacy engine returns none', async () => {
    mockGenerateWaiverRecommendations.mockResolvedValue({ recommendations: [], rosterNeeds: [], leagueContext: { leagueId: 'league-1', waiverType: 'faab', faabBudget: null, faabRemaining: null }, generatedAt: new Date().toISOString() })

    const result = await runLegacyWaiverGrader({ leagueId: 'league-1', managerKey: 'manager-1' })
    expect(result.topAddPlayerId).toBeNull()
    expect(result.error).toBeNull()
  })

  it('never throws — a legacy engine failure is caught and reported as an error, not propagated', async () => {
    mockGenerateWaiverRecommendations.mockRejectedValue(new Error('legacy engine exploded'))

    const result = await runLegacyWaiverGrader({ leagueId: 'league-1', managerKey: 'manager-1' })
    expect(result.error).toBe('legacy engine exploded')
    expect(result.topAddPlayerId).toBeNull()
  })
})
