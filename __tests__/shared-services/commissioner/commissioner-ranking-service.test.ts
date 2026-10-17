import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockComputePowerRankings } = vi.hoisted(() => ({ mockComputePowerRankings: vi.fn() }))

vi.mock('@/lib/league-power-rankings/PowerRankingEngine', () => ({ computePowerRankings: mockComputePowerRankings }))

import { buildCommissionerRanking } from '@/lib/shared-services/commissioner/CommissionerRankingService'
import type { CommissionerContext } from '@/lib/shared-services/commissioner/types'

function makeContext(powerRankingSupport: 'supported' | 'specialty_adapter_required' = 'supported'): CommissionerContext {
  return {
    leagueId: 'league-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    requestingUserRole: 'commissioner',
    missionControl: {} as never,
    leagueAnalytics: {} as never,
    formatAwareness: { leagueVariant: powerRankingSupport === 'specialty_adapter_required' ? 'best_ball' : 'redraft', isDynasty: false, powerRankingSupport, reason: powerRankingSupport === 'specialty_adapter_required' ? 'stub' : null },
    gameDayAttentionItems: null,
    managerTendencies: {},
  }
}

describe('buildCommissionerRanking', () => {
  beforeEach(() => vi.clearAllMocks())

  it('never calls the real engine for a format requiring a specialty adapter — returns null honestly', async () => {
    const result = await buildCommissionerRanking(makeContext('specialty_adapter_required'))
    expect(result).toBeNull()
    expect(mockComputePowerRankings).not.toHaveBeenCalled()
  })

  it('wraps a real computePowerRankings result for a supported format', async () => {
    mockComputePowerRankings.mockResolvedValue({
      leagueId: 'league-1',
      leagueName: 'L1',
      season: '2026',
      week: 5,
      teams: [{ rosterId: 1, ownerId: 'o1', displayName: 'Team A', username: null, rank: 1, prevRank: 2, rankDelta: 1 }],
      computedAt: Date.parse('2026-01-01T00:00:00.000Z'),
      formula: { recordWeight: 0.35, recentPerformanceWeight: 0.25, rosterStrengthWeight: 0.25, projectionStrengthWeight: 0.15 },
    })

    const result = await buildCommissionerRanking(makeContext(), 5)

    expect(mockComputePowerRankings).toHaveBeenCalledWith('league-1', 5)
    expect(result?.mode).toBe('general_v2')
    expect(result?.teams).toHaveLength(1)
    expect(result?.explanation).toContain('35%')
  })

  it('returns null honestly when the real engine itself returns null (e.g. no teams)', async () => {
    mockComputePowerRankings.mockResolvedValue(null)
    const result = await buildCommissionerRanking(makeContext())
    expect(result).toBeNull()
  })
})
