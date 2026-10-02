import { describe, expect, it } from 'vitest'
import { buildCommissionerBrief } from '@/lib/shared-services/commissioner/CommissionerBriefService'
import type { CommissionerContext, CommissionerPowerRanking } from '@/lib/shared-services/commissioner/types'

const HEALTHY_ENGINE = {
  overallStatus: 'healthy' as const,
  confidencePct: 90,
  biggestStrengths: ['Great trade activity'],
}

function makeContext(overrides: Partial<CommissionerContext> = {}): CommissionerContext {
  return {
    leagueId: 'league-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    requestingUserRole: 'commissioner',
    missionControl: {
      leagueHealth: { available: true, result: { engine: HEALTHY_ENGINE } },
      activity: { tradeCount: 3, waiverClaimCount: 5, draftPickCount: 0, rosterActivityCount: 10 },
      managerCounts: { activeManagers: 10, inactiveManagers: 0 },
      recommendedActions: [],
    } as never,
    leagueAnalytics: { available: true } as never,
    formatAwareness: { leagueVariant: 'redraft', isDynasty: false, powerRankingSupport: 'supported', reason: null },
    gameDayAttentionItems: null,
    managerTendencies: {},
    ...overrides,
  }
}

function makeRanking(): CommissionerPowerRanking {
  return {
    leagueId: 'league-1',
    week: 5,
    mode: 'general_v2',
    formulaVersion: '{}',
    support: 'supported',
    teams: [
      { rosterId: 1, ownerId: 'o1', displayName: 'Team A', username: null, rank: 1, prevRank: 3, rankDelta: 2 } as never,
      { rosterId: 2, ownerId: 'o2', displayName: 'Team B', username: null, rank: 2, prevRank: 1, rankDelta: -1 } as never,
    ],
    sourceAttribution: {} as never,
    explanation: 'Weighted formula',
  }
}

describe('buildCommissionerBrief', () => {
  it('builds every documented section with real facts, never fabricating a score/record/trade', () => {
    const brief = buildCommissionerBrief(makeContext(), makeRanking(), [])
    const keys = brief.sections.map((s) => s.key)
    expect(keys).toContain('league_overview')
    expect(keys).toContain('lineup_concerns')
    expect(keys).toContain('waiver_activity')
    expect(keys).toContain('trade_activity')
    expect(keys).toContain('commissioner_actions')
    expect(keys).toContain('data_quality_warnings')
    expect(brief.week).toBe(5)
  })

  it('surfaces biggest movers only when ranking data with real movement exists', () => {
    const brief = buildCommissionerBrief(makeContext(), makeRanking(), [])
    const movers = brief.sections.find((s) => s.key === 'biggest_movers')
    expect(movers?.facts[0]).toContain('Team A')
  })

  it('omits biggest movers honestly when no ranking is available', () => {
    const brief = buildCommissionerBrief(makeContext(), null, [])
    expect(brief.sections.some((s) => s.key === 'biggest_movers')).toBe(false)
  })

  it('surfaces real lineup-attention-carryover items as lineup concerns', () => {
    const attentionItems = [
      { reasonCode: 'lineup_attention_carryover' as const, category: 'starter_ruled_out', severity: 'critical' as const, leagueId: 'league-1', affectedManagerIds: [], message: 'Player X is Out', evidence: ['injuryStatus=Out'], confidence: 80, freshness: 'fresh' as const, risk: 'high' as const, recommendedAction: null, actionAvailableInApp: true, providerDeepLink: null, permissionRequired: 'member' as const },
    ]
    const brief = buildCommissionerBrief(makeContext(), null, attentionItems)
    const lineup = brief.sections.find((s) => s.key === 'lineup_concerns')
    expect(lineup?.facts).toContain('Player X is Out')
  })

  it('reports data quality warnings honestly when league health/analytics are unavailable', () => {
    const ctx = makeContext({ missionControl: { leagueHealth: { available: false, reason: 'x' }, activity: { tradeCount: 0, waiverClaimCount: 0, draftPickCount: 0, rosterActivityCount: 0 }, managerCounts: { activeManagers: 0, inactiveManagers: 0 }, recommendedActions: [] } as never, leagueAnalytics: { available: false } as never })
    const brief = buildCommissionerBrief(ctx, null, [])
    const dq = brief.sections.find((s) => s.key === 'data_quality_warnings')
    expect(dq?.facts.some((f) => f.includes('health'))).toBe(true)
    expect(dq?.facts.some((f) => f.includes('analytics'))).toBe(true)
    expect(brief.isHealthy).toBe(false)
    expect(brief.confidence).toBe(0)
  })

  it('flags specialty-adapter-required leagues in the data quality section, not the power-rankings section', () => {
    const ctx = makeContext({ formatAwareness: { leagueVariant: 'best_ball', isDynasty: false, powerRankingSupport: 'specialty_adapter_required', reason: 'Best Ball power rankings are a confirmed stub.' } })
    const brief = buildCommissionerBrief(ctx, null, [])
    const dq = brief.sections.find((s) => s.key === 'data_quality_warnings')
    expect(dq?.facts.some((f) => f.includes('Best Ball'))).toBe(true)
  })
})
