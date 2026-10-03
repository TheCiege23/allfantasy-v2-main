import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDeriveLeagueAttentionSignals } = vi.hoisted(() => ({ mockDeriveLeagueAttentionSignals: vi.fn() }))

vi.mock('@/lib/decision-os/attentionSignals', () => ({ deriveLeagueAttentionSignals: mockDeriveLeagueAttentionSignals }))

import { buildCommissionerAttentionItems } from '@/lib/shared-services/commissioner/CommissionerAttentionService'
import type { CommissionerContext } from '@/lib/shared-services/commissioner/types'

function makeContext(overrides: Partial<CommissionerContext> = {}): CommissionerContext {
  return {
    leagueId: 'league-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    requestingUserRole: 'commissioner',
    missionControl: {
      leagueHealth: { available: false, reason: 'league_health_unavailable' },
      recommendedActions: [],
    } as never,
    leagueAnalytics: {} as never,
    formatAwareness: { leagueVariant: null, isDynasty: false, powerRankingSupport: 'supported', reason: null },
    gameDayAttentionItems: null,
    managerTendencies: {},
    ...overrides,
  }
}

describe('buildCommissionerAttentionItems', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeriveLeagueAttentionSignals.mockReturnValue([])
  })

  it('calls the real deriveLeagueAttentionSignals with documented placeholder financialStatus/draftDateUtc', () => {
    buildCommissionerAttentionItems(makeContext())
    expect(mockDeriveLeagueAttentionSignals).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-1', financialStatus: 'UNKNOWN', draftDateUtc: null })
    )
  })

  it('maps a real legacy signal into a CommissionerAttentionItem', () => {
    mockDeriveLeagueAttentionSignals.mockReturnValue([
      { id: 's1', leagueId: 'league-1', type: 'low_league_health', severity: 'critical', priorityScore: 100, title: 'Low health', explanation: 'League health is low.', recommendedAction: 'Review the league.' },
    ])
    const items = buildCommissionerAttentionItems(makeContext())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ reasonCode: 'legacy_signal', category: 'low_league_health', severity: 'critical', message: 'Low health', recommendedAction: 'Review the league.' })
  })

  it('carries over non-info Game Day lineup attention items as a new category', () => {
    const ctx = makeContext({
      gameDayAttentionItems: [
        { reasonCode: 'starter_ruled_out', severity: 'critical', message: 'Player Out', leagueId: 'league-1', leagueName: null, rosterId: null, playerId: 'p1', playerName: 'Player One', evidence: ['x'], freshness: 'fresh', sourceAttribution: {} as never, confidence: 80, risk: 'high', actionable: true, providerDeepLink: null },
        { reasonCode: 'missing_projection', severity: 'info', message: 'No projection', leagueId: 'league-1', leagueName: null, rosterId: null, playerId: 'p2', playerName: 'Player Two', evidence: [], freshness: 'fresh', sourceAttribution: {} as never, confidence: 50, risk: 'low', actionable: true, providerDeepLink: null },
      ],
    })
    const items = buildCommissionerAttentionItems(ctx)
    expect(items).toHaveLength(1) // info severity dropped
    expect(items[0].reasonCode).toBe('lineup_attention_carryover')
    expect(items[0].severity).toBe('critical')
  })

  it('returns an empty list when there are no legacy signals and no Game Day items', () => {
    expect(buildCommissionerAttentionItems(makeContext())).toEqual([])
  })
})
