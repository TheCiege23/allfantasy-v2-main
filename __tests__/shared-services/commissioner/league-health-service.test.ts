import { describe, expect, it } from 'vitest'
import { buildLeagueHealthAssessment } from '@/lib/shared-services/commissioner/LeagueHealthService'
import type { CommissionerContext } from '@/lib/shared-services/commissioner/types'

const BASE_ENGINE = {
  leagueHealthScore: 80,
  engagementScore: 80,
  fairnessScore: 80,
  sustainabilityScore: 80,
  confidencePct: 90,
  overallStatus: 'healthy' as const,
  biggestStrengths: [],
  biggestProblems: ['Some problem'],
  urgentAlerts: ['Urgent alert'],
  earlyWarningSignals: ['Early warning'],
  inactiveManagerNotes: [],
  transactionHealthNotes: [],
  waiverHealthNotes: [],
  tradeHealthNotes: [],
  rosterBalanceNotes: [],
  commissionerHealthNotes: [],
  interventionRecommendations: [],
  summary: '',
  generatedAt: '2026-01-01T00:00:00.000Z',
  healthTrend: 'stable' as const,
  churnRiskScore: 10,
  disputeRiskScore: 10,
  abandonmentRiskScore: 10,
  engagementDropoffFlags: [],
}

function makeContext(overallStatus: string, healthAvailable = true): CommissionerContext {
  return {
    leagueId: 'league-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    requestingUserRole: 'commissioner',
    missionControl: {
      leagueHealth: healthAvailable
        ? { available: true, result: { engine: { ...BASE_ENGINE, overallStatus: overallStatus as never }, decisionOs: {} as never, fieldProvenance: {} as never } }
        : { available: false, reason: 'league_health_unavailable' },
    } as never,
    leagueAnalytics: {} as never,
    formatAwareness: { leagueVariant: null, isDynasty: false, powerRankingSupport: 'supported', reason: null },
    gameDayAttentionItems: null,
    managerTendencies: {},
  }
}

describe('buildLeagueHealthAssessment', () => {
  it('maps excellent and healthy both to the healthy category', () => {
    expect(buildLeagueHealthAssessment(makeContext('excellent')).category).toBe('healthy')
    expect(buildLeagueHealthAssessment(makeContext('healthy')).category).toBe('healthy')
  })

  it('maps watch directly', () => {
    expect(buildLeagueHealthAssessment(makeContext('watch')).category).toBe('watch')
  })

  it('maps at_risk to attention_required', () => {
    expect(buildLeagueHealthAssessment(makeContext('at_risk')).category).toBe('attention_required')
  })

  it('maps critical directly', () => {
    expect(buildLeagueHealthAssessment(makeContext('critical')).category).toBe('critical')
  })

  it('reports unavailable honestly and never fabricates a score when league health could not be resolved', () => {
    const result = buildLeagueHealthAssessment(makeContext('healthy', false))
    expect(result.category).toBe('unavailable')
    expect(result.score).toBe(0)
    expect(result.confidence).toBe(0)
  })

  it('reuses the real engine score directly, never recomputing it', () => {
    const result = buildLeagueHealthAssessment(makeContext('healthy'))
    expect(result.score).toBe(80)
    expect(result.issues).toEqual(['Some problem'])
    expect(result.evidence).toEqual(['Urgent alert', 'Early warning'])
  })
})
