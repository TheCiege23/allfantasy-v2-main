import { describe, expect, it } from 'vitest'
import { buildLeaguePulse } from '@/lib/shared-services/commissioner/LeaguePulseService'
import type { CommissionerContext } from '@/lib/shared-services/commissioner/types'

const HEALTHY_ENGINE = {
  leagueHealthScore: 80,
  engagementScore: 80,
  fairnessScore: 80,
  sustainabilityScore: 80,
  confidencePct: 90,
  overallStatus: 'healthy' as const,
  biggestStrengths: ['Great trade activity'],
  biggestProblems: [],
  urgentAlerts: [],
  earlyWarningSignals: [],
  inactiveManagerNotes: [],
  transactionHealthNotes: ['Healthy trade volume'],
  waiverHealthNotes: [],
  tradeHealthNotes: [],
  rosterBalanceNotes: [],
  commissionerHealthNotes: [],
  interventionRecommendations: [],
  summary: 'Healthy league',
  generatedAt: '2026-01-01T00:00:00.000Z',
  healthTrend: 'stable' as const,
  churnRiskScore: 10,
  disputeRiskScore: 10,
  abandonmentRiskScore: 10,
  engagementDropoffFlags: [],
}

function makeContext(overrides: Partial<CommissionerContext> = {}): CommissionerContext {
  return {
    leagueId: 'league-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    requestingUserRole: 'commissioner',
    missionControl: {
      leagueId: 'league-1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      leagueHealth: {
        available: true,
        result: { engine: HEALTHY_ENGINE, decisionOs: { trend: { available: true, direction: 'stable', eventCountDelta: 0 } } as never, fieldProvenance: { a: 'decision_os' } as never },
      },
      trend: { available: true, direction: 'stable', eventCountDelta: 0 } as never,
      managerCounts: { activeManagers: 10, inactiveManagers: 0 },
      activity: { tradeCount: 5, waiverClaimCount: 8, draftPickCount: 0, rosterActivityCount: 20 },
      managersAtRetentionRisk: [],
      recommendedActions: [],
      fieldProvenance: { a: 'decision_os' } as never,
    },
    leagueAnalytics: { leagueId: 'league-1', generatedAt: '2026-01-01T00:00:00.000Z', available: true } as never,
    formatAwareness: { leagueVariant: 'redraft', isDynasty: false, powerRankingSupport: 'supported', reason: null },
    gameDayAttentionItems: null,
    managerTendencies: {},
    ...overrides,
  }
}

describe('buildLeaguePulse', () => {
  it('reports good states with visible, explainable component dimensions for a healthy league', () => {
    const pulse = buildLeaguePulse(makeContext())
    expect(pulse.dimensions.length).toBeGreaterThan(0)
    expect(pulse.dimensions.every((d) => d.explanation.length > 0)).toBe(true)
    const competition = pulse.dimensions.find((d) => d.dimension === 'competition')
    expect(competition?.state).toBe('good')
    expect(pulse.compositeScore).toBeGreaterThan(0)
  })

  it('never collapses into a single unexplained number — composite is paired with per-dimension explanations', () => {
    const pulse = buildLeaguePulse(makeContext())
    expect(pulse.compositeExplanation).toContain('dimension')
    for (const dim of pulse.dimensions) {
      expect(dim.evidence).toBeDefined()
      expect(dim.sourceAttribution).toBeDefined()
    }
  })

  it('reports unavailable dimensions honestly when league health could not be resolved', () => {
    const pulse = buildLeaguePulse(makeContext({ missionControl: { ...makeContext().missionControl, leagueHealth: { available: false, reason: 'league_health_unavailable' } } }))
    const competition = pulse.dimensions.find((d) => d.dimension === 'competition')
    expect(competition?.state).toBe('unavailable')
    expect(competition?.confidence).toBe(0)
  })

  it('flags competitive imbalance as attention_required when fairness is low, without accusing anyone', () => {
    const lowFairnessEngine = { ...HEALTHY_ENGINE, fairnessScore: 30, overallStatus: 'at_risk' as const }
    const ctx = makeContext({
      missionControl: {
        ...makeContext().missionControl,
        leagueHealth: { available: true, result: { engine: lowFairnessEngine, decisionOs: { trend: { available: false, reason: 'no_snapshots' } } as never, fieldProvenance: {} as never } },
      },
    })
    const pulse = buildLeaguePulse(ctx)
    const competition = pulse.dimensions.find((d) => d.dimension === 'competition')
    expect(competition?.state).toBe('attention_required')
    expect(competition?.explanation).not.toMatch(/collusion|tanking|cheat/i)
  })

  it('reports lineup_health as unavailable when no Game Day attention items were assembled', () => {
    const pulse = buildLeaguePulse(makeContext())
    const lineup = pulse.dimensions.find((d) => d.dimension === 'lineup_health')
    expect(lineup?.state).toBe('unavailable')
  })

  it('reports lineup_health as attention_required when critical Game Day items exist', () => {
    const ctx = makeContext({
      gameDayAttentionItems: [
        { reasonCode: 'starter_ruled_out', severity: 'critical', message: 'x', leagueId: 'league-1', leagueName: null, rosterId: null, playerId: null, playerName: null, evidence: [], freshness: 'fresh', sourceAttribution: {} as never, confidence: 80, risk: 'high', actionable: true, providerDeepLink: null },
      ],
    })
    const pulse = buildLeaguePulse(ctx)
    const lineup = pulse.dimensions.find((d) => d.dimension === 'lineup_health')
    expect(lineup?.state).toBe('attention_required')
  })

  it('reports data_quality proportional to real vs schema-default field provenance', () => {
    const ctx = makeContext({ missionControl: { ...makeContext().missionControl, fieldProvenance: { a: 'decision_os', b: 'schema_default' } as never } })
    const pulse = buildLeaguePulse(ctx)
    const dq = pulse.dimensions.find((d) => d.dimension === 'data_quality')
    expect(dq?.state).toBe('watch')
    expect(dq?.confidence).toBe(50)
  })
})
