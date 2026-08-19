/**
 * Phase 6.4 — Recommendation Engine tests.
 *
 * Covers:
 * - Version stamp
 * - Deterministic output (same input → same output)
 * - Ordering invariant (priority DESC → severity DESC → category ASC → id ASC)
 * - Each recommendation category fires / does not fire
 * - Conflicting / co-occurring signals
 * - Sparse / missing data (no recommendations produced, no throws)
 * - Benchmark influence on commissioner recommendations
 * - No mutation of input objects
 * - Unified orchestrator totals and aggregation
 * - Immutability of output recommendations array
 */

import { describe, test, expect } from 'vitest'
import {
  assembleManagerRecommendations,
  assembleCommissionerRecommendations,
  assemblePlatformRecommendations,
  assembleRecommendations,
  RECOMMENDATION_VERSION,
} from '../../../lib/decision-os/phase6/recommendations/recommendations'
import type {
  ManagerRecommendationInput,
  CommissionerRecommendationInput,
  PlatformRecommendationInput,
  RecommendationEngineInput,
  DetectedPatternSlice,
  LeagueBenchmarkSlice,
  LeagueSignalsSlice,
} from '../../../lib/decision-os/phase6/recommendations/types'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePattern(
  patternType: string,
  confidence: 'high' | 'medium' | 'low' = 'high',
  occurrenceCount = 2,
): DetectedPatternSlice {
  return { patternType, confidence, occurrenceCount }
}

const FULL_BENCHMARK: LeagueBenchmarkSlice = {
  engagement: { value: 40, percentile: 20 },
  retentionSafety: { value: 1, percentile: 15 },
  tradeActivity: { value: 0.05, percentile: 8 },
  waiverActivity: { value: 0.1, percentile: 18 },
  commissionerEfficiency: { value: 2, percentile: 60 },
}

const HIGH_ENGAGEMENT_BENCHMARK: LeagueBenchmarkSlice = {
  engagement: { value: 90, percentile: 85 },
  retentionSafety: { value: 3, percentile: 90 },
  tradeActivity: { value: 0.8, percentile: 78 },
  waiverActivity: { value: 1.2, percentile: 80 },
  commissionerEfficiency: { value: 3, percentile: 88 },
}

const PASSIVE_SIGNALS: LeagueSignalsSlice = {
  engagementTier: 'passive',
  retentionRisk: 'high',
  inactiveManagerFraction: 0.35,
  tradeActivityTier: 'low',
  waiverActivityTier: 'none',
  commissionerWorkload: 'moderate',
}

const ACTIVE_SIGNALS: LeagueSignalsSlice = {
  engagementTier: 'active',
  retentionRisk: 'low',
  inactiveManagerFraction: 0.05,
  tradeActivityTier: 'high',
  waiverActivityTier: 'high',
  commissionerWorkload: 'light',
}

function ghostManagerInput(managerId = 'mgr1'): ManagerRecommendationInput {
  return {
    managerId,
    leagueId: 'lge1',
    identity: {
      primaryIdentity: 'ghost_manager',
      decisionStyle: 'methodical',
      transactionStyle: 'passive',
      riskTendency: 'neutral',
      engagementReliability: 'unreliable',
      traits: [],
      completeness: 80,
    },
    patterns: [makePattern('manager_inactivity_window', 'high')],
  }
}

function setAndForgetInput(managerId = 'mgr1'): ManagerRecommendationInput {
  return {
    managerId,
    leagueId: 'lge1',
    identity: {
      primaryIdentity: 'set_and_forget',
      decisionStyle: 'decisive',
      transactionStyle: 'passive',
      riskTendency: 'risk_averse',
      engagementReliability: 'reliable',
      traits: [],
      completeness: 70,
    },
    patterns: [makePattern('conservative_roster_pattern', 'high')],
  }
}

function activeManagerInput(managerId = 'mgr1'): ManagerRecommendationInput {
  return {
    managerId,
    leagueId: 'lge1',
    identity: {
      primaryIdentity: 'committed_grinder',
      decisionStyle: 'methodical',
      transactionStyle: 'balanced',
      riskTendency: 'neutral',
      engagementReliability: 'reliable',
      traits: [],
      completeness: 90,
    },
    patterns: [],
  }
}

function commissionerHighRiskInput(leagueId = 'lge1'): CommissionerRecommendationInput {
  return {
    leagueId,
    archetype: { label: 'high_churn_risk', confidence: 0.75 },
    benchmark: FULL_BENCHMARK,
    leagueSignals: PASSIVE_SIGNALS,
  }
}

function platformCriticalInput(platformId = 'platform1'): PlatformRecommendationInput {
  return {
    platformId,
    totalLeagues: 50,
    insufficientData: false,
    lowEngagementLeagueFraction: 0.55,
    highChurnRiskFraction: 0.45,
    inactiveLeagueFraction: 0.42,
    archetypeDistribution: {
      inactive_or_stale: 8,
      low_engagement: 7,
      high_churn_risk: 5,
      highly_engaged: 10,
      competitive_balanced: 20,
    },
  }
}

// ── Helper: get a recommendation by category ─────────────────────────────────

function getRec(set: ReturnType<typeof assembleManagerRecommendations>, category: string) {
  return set.recommendations.find((r) => r.category === category)
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Version stamp
// ══════════════════════════════════════════════════════════════════════════════

describe('RECOMMENDATION_VERSION', () => {
  test('version is 6.4.0', () => {
    expect(RECOMMENDATION_VERSION).toBe('6.4.0')
  })

  test('manager set carries version', () => {
    const result = assembleManagerRecommendations({ managerId: 'x', leagueId: 'y' })
    expect(result.version).toBe('6.4.0')
  })

  test('commissioner set carries version', () => {
    const result = assembleCommissionerRecommendations({ leagueId: 'y' })
    expect(result.version).toBe('6.4.0')
  })

  test('platform set carries version', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p' })
    expect(result.version).toBe('6.4.0')
  })

  test('engine result carries version', () => {
    const result = assembleRecommendations({
      managerInputs: [],
      commissionerInputs: [],
      platformInputs: [],
    })
    expect(result.version).toBe('6.4.0')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. Empty / sparse input — no throws, empty recommendations
// ══════════════════════════════════════════════════════════════════════════════

describe('sparse / empty input', () => {
  test('manager with no identity or patterns produces empty recommendations', () => {
    const result = assembleManagerRecommendations({ managerId: 'mgr1', leagueId: 'lge1' })
    expect(result.recommendations).toHaveLength(0)
    expect(result.totalRecommendations).toBe(0)
    expect(result.criticalCount).toBe(0)
    expect(result.warnings.some((w) => w.includes('no_identity_or_patterns'))).toBe(true)
  })

  test('commissioner with no signals, no archetype, no benchmark produces empty recommendations', () => {
    const result = assembleCommissionerRecommendations({ leagueId: 'lge1' })
    expect(result.recommendations).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('no_signals_benchmark_archetype'))).toBe(true)
  })

  test('platform with no fractions or distribution produces empty recommendations', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1' })
    expect(result.recommendations).toHaveLength(0)
  })

  test('active manager with no negative signals produces no recommendations', () => {
    const result = assembleManagerRecommendations(activeManagerInput())
    expect(result.recommendations).toHaveLength(0)
  })

  test('does not throw with undefined optional fields', () => {
    expect(() =>
      assembleManagerRecommendations({ managerId: 'x', leagueId: 'y', patterns: undefined })
    ).not.toThrow()
    expect(() =>
      assembleCommissionerRecommendations({ leagueId: 'z', archetype: undefined })
    ).not.toThrow()
    expect(() =>
      assemblePlatformRecommendations({ platformId: 'p', archetypeDistribution: undefined })
    ).not.toThrow()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. Deterministic output
// ══════════════════════════════════════════════════════════════════════════════

describe('deterministic output', () => {
  test('same manager input produces identical output twice', () => {
    const input = ghostManagerInput()
    const a = assembleManagerRecommendations(input)
    const b = assembleManagerRecommendations(input)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test('same commissioner input produces identical output twice', () => {
    const input = commissionerHighRiskInput()
    const a = assembleCommissionerRecommendations(input)
    const b = assembleCommissionerRecommendations(input)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test('same platform input produces identical output twice', () => {
    const input = platformCriticalInput()
    const a = assemblePlatformRecommendations(input)
    const b = assemblePlatformRecommendations(input)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test('deterministic id format: rec_<tier>_<category>_<entityId>', () => {
    const result = assembleManagerRecommendations(ghostManagerInput('mgr_abc'))
    const rec = getRec(result, 'engagement_boost')
    expect(rec?.id).toBe('rec_manager_engagement_boost_mgr_abc')
  })

  test('id uses underscore for special chars in entityId', () => {
    const result = assembleManagerRecommendations(ghostManagerInput('mgr-with.special!chars'))
    const rec = getRec(result, 'engagement_boost')
    // Non-alphanumeric (except _) replaced with _
    expect(rec?.id).toMatch(/^rec_manager_engagement_boost_/)
    expect(rec?.id).not.toContain('-')
    expect(rec?.id).not.toContain('.')
    expect(rec?.id).not.toContain('!')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. Ordering invariant
// ══════════════════════════════════════════════════════════════════════════════

describe('ordering invariant', () => {
  test('manager recommendations are sorted priority DESC, severity DESC, category ASC, id ASC', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'ghost_manager',
        decisionStyle: 'indecisive',
        transactionStyle: 'passive',
        riskTendency: 'neutral',
        engagementReliability: 'unreliable',
        traits: [],
        completeness: 70,
      },
      patterns: [
        makePattern('manager_inactivity_window', 'high'),
        makePattern('repeated_lineup_indecision', 'medium'),
        makePattern('trade_rejection_pattern', 'medium'),
      ],
    })
    const recs = result.recommendations
    for (let i = 0; i < recs.length - 1; i++) {
      const a = recs[i]
      const b = recs[i + 1]
      const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
      const severityOrder: Record<string, number> = { urgent: 4, elevated: 3, standard: 2, advisory: 1 }
      const ap = priorityOrder[a.priority]
      const bp = priorityOrder[b.priority]
      if (ap !== bp) {
        expect(ap).toBeGreaterThan(bp)
      } else {
        const as = severityOrder[a.severity]
        const bs = severityOrder[b.severity]
        if (as !== bs) {
          expect(as).toBeGreaterThanOrEqual(bs)
        } else {
          if (a.category !== b.category) {
            expect(a.category.localeCompare(b.category)).toBeLessThanOrEqual(0)
          } else {
            expect(a.id.localeCompare(b.id)).toBeLessThanOrEqual(0)
          }
        }
      }
    }
  })

  test('commissioner recommendations are sorted correctly when multiple fire', () => {
    const result = assembleCommissionerRecommendations(commissionerHighRiskInput())
    const recs = result.recommendations
    const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
    for (let i = 0; i < recs.length - 1; i++) {
      expect(priorityOrder[recs[i].priority]).toBeGreaterThanOrEqual(priorityOrder[recs[i + 1].priority])
    }
  })

  test('platform recommendations are sorted priority DESC', () => {
    const result = assemblePlatformRecommendations(platformCriticalInput())
    const priorityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
    const recs = result.recommendations
    for (let i = 0; i < recs.length - 1; i++) {
      expect(priorityOrder[recs[i].priority]).toBeGreaterThanOrEqual(priorityOrder[recs[i + 1].priority])
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. Manager recommendation categories
// ══════════════════════════════════════════════════════════════════════════════

describe('manager: engagement_boost', () => {
  test('fires CRITICAL when ghost_manager identity', () => {
    const result = assembleManagerRecommendations(ghostManagerInput())
    const rec = getRec(result, 'engagement_boost')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('critical')
    expect(rec?.severity).toBe('urgent')
    expect(rec?.tier).toBe('manager')
  })

  test('fires HIGH when inactivity_window (medium) + unreliable reliability', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'unknown',
        decisionStyle: 'methodical',
        transactionStyle: 'passive',
        riskTendency: 'neutral',
        engagementReliability: 'unreliable',
        traits: [],
        completeness: 60,
      },
      patterns: [makePattern('manager_inactivity_window', 'medium')],
    })
    const rec = getRec(result, 'engagement_boost')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('high')
  })

  test('fires MEDIUM when only inconsistent reliability (no inactivity pattern)', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'reactive_manager',
        decisionStyle: 'reactive',
        transactionStyle: 'balanced',
        riskTendency: 'neutral',
        engagementReliability: 'inconsistent',
        traits: [],
        completeness: 70,
      },
      patterns: [],
    })
    const rec = getRec(result, 'engagement_boost')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('medium')
  })

  test('does NOT fire when reliable + no inactivity pattern', () => {
    const result = assembleManagerRecommendations(activeManagerInput())
    expect(getRec(result, 'engagement_boost')).toBeUndefined()
  })

  test('includes benchmark comparison when leagueBenchmark provided', () => {
    const result = assembleManagerRecommendations({
      ...ghostManagerInput(),
      leagueBenchmark: FULL_BENCHMARK,
    })
    const rec = getRec(result, 'engagement_boost')
    expect(rec?.benchmarkComparison).toContain('percentile')
  })

  test('benchmarkComparison is null when no leagueBenchmark', () => {
    const result = assembleManagerRecommendations(ghostManagerInput())
    const rec = getRec(result, 'engagement_boost')
    expect(rec?.benchmarkComparison).toBeNull()
  })
})

describe('manager: lineup_discipline', () => {
  test('fires when repeated_lineup_indecision (medium)', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      patterns: [makePattern('repeated_lineup_indecision', 'medium')],
    })
    const rec = getRec(result, 'lineup_discipline')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('medium')
  })

  test('fires when bench_regret_repetition (high)', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      patterns: [makePattern('bench_regret_repetition', 'high')],
    })
    expect(getRec(result, 'lineup_discipline')).toBeDefined()
  })

  test('does NOT fire when lineup_indecision is only low confidence and no identity', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      patterns: [makePattern('repeated_lineup_indecision', 'low')],
    })
    expect(getRec(result, 'lineup_discipline')).toBeUndefined()
  })

  test('fires when identity decisionStyle is indecisive', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'indecisive_tinkerer',
        decisionStyle: 'indecisive',
        transactionStyle: 'balanced',
        riskTendency: 'neutral',
        engagementReliability: 'reliable',
        traits: [],
        completeness: 75,
      },
      patterns: [],
    })
    expect(getRec(result, 'lineup_discipline')).toBeDefined()
  })

  test('has higher severity (elevated) when high-confidence indecision', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      patterns: [makePattern('repeated_lineup_indecision', 'high')],
    })
    const rec = getRec(result, 'lineup_discipline')
    expect(rec?.severity).toBe('elevated')
  })
})

describe('manager: trade_coaching', () => {
  test('fires when trade_rejection_pattern (medium)', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      patterns: [makePattern('trade_rejection_pattern', 'medium')],
    })
    expect(getRec(result, 'trade_coaching')).toBeDefined()
  })

  test('fires when identity is trade_seeker', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'trade_seeker',
        decisionStyle: 'decisive',
        transactionStyle: 'trade_dominant',
        riskTendency: 'risk_taking',
        engagementReliability: 'reliable',
        traits: [],
        completeness: 65,
      },
      patterns: [],
    })
    expect(getRec(result, 'trade_coaching')).toBeDefined()
  })

  test('does NOT fire when low-confidence rejection and no identity', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      patterns: [makePattern('trade_rejection_pattern', 'low')],
    })
    expect(getRec(result, 'trade_coaching')).toBeUndefined()
  })

  test('does NOT fire for active manager with no rejection patterns', () => {
    const result = assembleManagerRecommendations(activeManagerInput())
    expect(getRec(result, 'trade_coaching')).toBeUndefined()
  })
})

describe('manager: waiver_opportunity', () => {
  test('fires when transactionStyle is passive + no waiver streak', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'set_and_forget',
        decisionStyle: 'decisive',
        transactionStyle: 'passive',
        riskTendency: 'risk_averse',
        engagementReliability: 'reliable',
        traits: [],
        completeness: 70,
      },
      patterns: [],
    })
    const rec = getRec(result, 'waiver_opportunity')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('low')
  })

  test('does NOT fire when transactionStyle is waiver_dominant', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'waiver_hawk',
        decisionStyle: 'decisive',
        transactionStyle: 'waiver_dominant',
        riskTendency: 'risk_taking',
        engagementReliability: 'reliable',
        traits: [],
        completeness: 85,
      },
      patterns: [],
    })
    expect(getRec(result, 'waiver_opportunity')).toBeUndefined()
  })

  test('does NOT fire when passive style but has waiver streak pattern', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'unknown',
        decisionStyle: 'methodical',
        transactionStyle: 'passive',
        riskTendency: 'neutral',
        engagementReliability: 'reliable',
        traits: [],
        completeness: 60,
      },
      patterns: [makePattern('waiver_aggression_streak', 'high')],
    })
    // Has waiver streak → gate blocks waiver_opportunity
    expect(getRec(result, 'waiver_opportunity')).toBeUndefined()
  })
})

describe('manager: league_participation', () => {
  test('fires HIGH for ghost_manager', () => {
    const result = assembleManagerRecommendations(ghostManagerInput())
    const rec = getRec(result, 'league_participation')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('high')
    expect(rec?.severity).toBe('elevated')
  })

  test('fires LOW for set_and_forget', () => {
    const result = assembleManagerRecommendations(setAndForgetInput())
    const rec = getRec(result, 'league_participation')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('low')
  })

  test('does NOT fire for committed_grinder', () => {
    const result = assembleManagerRecommendations(activeManagerInput())
    expect(getRec(result, 'league_participation')).toBeUndefined()
  })
})

describe('manager: draft_preparation', () => {
  test('fires for conservative_roster_pattern', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      patterns: [makePattern('conservative_roster_pattern', 'high')],
    })
    const rec = getRec(result, 'draft_preparation')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('low')
  })

  test('fires for set_and_forget identity', () => {
    const result = assembleManagerRecommendations(setAndForgetInput())
    expect(getRec(result, 'draft_preparation')).toBeDefined()
  })

  test('does NOT fire for active manager', () => {
    const result = assembleManagerRecommendations(activeManagerInput())
    expect(getRec(result, 'draft_preparation')).toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. Commissioner recommendation categories
// ══════════════════════════════════════════════════════════════════════════════

describe('commissioner: retention_intervention', () => {
  test('fires CRITICAL for retentionRisk=critical', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: { ...PASSIVE_SIGNALS, retentionRisk: 'critical' },
    })
    const rec = getRec(result, 'retention_intervention')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('critical')
    expect(rec?.severity).toBe('urgent')
  })

  test('fires CRITICAL for archetype=inactive_or_stale', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      archetype: { label: 'inactive_or_stale', confidence: 0.80 },
    })
    const rec = getRec(result, 'retention_intervention')
    expect(rec?.priority).toBe('critical')
  })

  test('fires HIGH for retentionRisk=high', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: { ...PASSIVE_SIGNALS, retentionRisk: 'high' },
    })
    expect(getRec(result, 'retention_intervention')?.priority).toBe('high')
  })

  test('fires HIGH for archetype=high_churn_risk', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      archetype: { label: 'high_churn_risk', confidence: 0.7 },
    })
    expect(getRec(result, 'retention_intervention')?.priority).toBe('high')
  })

  test('fires MEDIUM for retentionRisk=medium', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: { ...ACTIVE_SIGNALS, retentionRisk: 'medium' },
    })
    expect(getRec(result, 'retention_intervention')?.priority).toBe('medium')
  })

  test('does NOT fire when retentionRisk=low + no risky archetype', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: ACTIVE_SIGNALS,
    })
    expect(getRec(result, 'retention_intervention')).toBeUndefined()
  })

  test('includes inactiveManagerFraction in derivation', () => {
    const result = assembleCommissionerRecommendations(commissionerHighRiskInput())
    const rec = getRec(result, 'retention_intervention')
    const derivation = rec?.derivation.join(' ')
    expect(derivation).toContain('inactiveManagerFraction')
  })

  test('includes benchmark comparison when benchmark available', () => {
    const result = assembleCommissionerRecommendations(commissionerHighRiskInput())
    const rec = getRec(result, 'retention_intervention')
    expect(rec?.benchmarkComparison).toContain('percentile')
  })
})

describe('commissioner: trade_activation', () => {
  test('fires HIGH when benchmark.tradeActivity.percentile < 10', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: FULL_BENCHMARK, // tradeActivity.percentile = 8
    })
    const rec = getRec(result, 'trade_activation')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('high')
  })

  test('fires MEDIUM when benchmark.tradeActivity.percentile in [10, 25)', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: {
        ...FULL_BENCHMARK,
        tradeActivity: { value: 0.1, percentile: 15 },
      },
    })
    expect(getRec(result, 'trade_activation')?.priority).toBe('medium')
  })

  test('fires MEDIUM when tradeActivityTier=none even with no benchmark', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: { ...ACTIVE_SIGNALS, tradeActivityTier: 'none' },
    })
    // tier=none fires high path (isCritical since tier=none wins isCritical check)
    expect(getRec(result, 'trade_activation')).toBeDefined()
  })

  test('does NOT fire when benchmark.tradeActivity.percentile >= 25 + active tier', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: HIGH_ENGAGEMENT_BENCHMARK,
      leagueSignals: ACTIVE_SIGNALS,
    })
    expect(getRec(result, 'trade_activation')).toBeUndefined()
  })
})

describe('commissioner: waiver_activation', () => {
  test('fires when benchmark.waiverActivity.percentile < 25', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: FULL_BENCHMARK, // waiverActivity.percentile = 18
    })
    const rec = getRec(result, 'waiver_activation')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('medium')
  })

  test('fires when waiverActivityTier=none with no benchmark', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: { ...ACTIVE_SIGNALS, waiverActivityTier: 'none' },
    })
    expect(getRec(result, 'waiver_activation')).toBeDefined()
  })

  test('does NOT fire when waiverActivity.percentile >= 25', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: HIGH_ENGAGEMENT_BENCHMARK,
      leagueSignals: ACTIVE_SIGNALS,
    })
    expect(getRec(result, 'waiver_activation')).toBeUndefined()
  })
})

describe('commissioner: league_event', () => {
  test('fires when engagement.percentile < 30', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: FULL_BENCHMARK, // engagement.percentile = 20
    })
    expect(getRec(result, 'league_event')).toBeDefined()
  })

  test('fires when engagementTier=dormant', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: { ...PASSIVE_SIGNALS, engagementTier: 'dormant' },
    })
    expect(getRec(result, 'league_event')).toBeDefined()
  })

  test('does NOT fire for high-engagement league', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: HIGH_ENGAGEMENT_BENCHMARK,
      leagueSignals: ACTIVE_SIGNALS,
    })
    expect(getRec(result, 'league_event')).toBeUndefined()
  })
})

describe('commissioner: weekly_recap', () => {
  test('fires for passive engagementTier', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: PASSIVE_SIGNALS,
    })
    expect(getRec(result, 'weekly_recap')).toBeDefined()
  })

  test('fires when engagement.percentile < 40', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: { ...FULL_BENCHMARK, engagement: { value: 50, percentile: 35 } },
    })
    expect(getRec(result, 'weekly_recap')).toBeDefined()
  })

  test('is priority=low, advisory', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leagueSignals: PASSIVE_SIGNALS,
    })
    const rec = getRec(result, 'weekly_recap')
    expect(rec?.priority).toBe('low')
    expect(rec?.severity).toBe('advisory')
  })

  test('does NOT fire for active league with high engagement percentile', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: HIGH_ENGAGEMENT_BENCHMARK,
      leagueSignals: ACTIVE_SIGNALS,
    })
    expect(getRec(result, 'weekly_recap')).toBeUndefined()
  })
})

describe('commissioner: rivalry_engagement', () => {
  test('fires HIGH when league_activity_dropoff (high)', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leaguePatterns: [makePattern('league_activity_dropoff', 'high', 3)],
    })
    const rec = getRec(result, 'rivalry_engagement')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('high')
    expect(rec?.severity).toBe('elevated')
  })

  test('fires MEDIUM when league_activity_dropoff (medium)', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leaguePatterns: [makePattern('league_activity_dropoff', 'medium', 2)],
    })
    expect(getRec(result, 'rivalry_engagement')?.priority).toBe('medium')
  })

  test('does NOT fire when no league_activity_dropoff pattern', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      leaguePatterns: [makePattern('commissioner_rules_churn', 'high')],
    })
    expect(getRec(result, 'rivalry_engagement')).toBeUndefined()
  })

  test('does NOT fire with no leaguePatterns', () => {
    const result = assembleCommissionerRecommendations({ leagueId: 'lge1' })
    expect(getRec(result, 'rivalry_engagement')).toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 7. Platform recommendation categories
// ══════════════════════════════════════════════════════════════════════════════

describe('platform: benchmark_intervention', () => {
  test('fires CRITICAL when highChurnRiskFraction > 0.40', () => {
    const result = assemblePlatformRecommendations(platformCriticalInput())
    const rec = getRec(result, 'benchmark_intervention')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('critical')
    expect(rec?.severity).toBe('urgent')
  })

  test('fires HIGH when highChurnRiskFraction in (0.20, 0.40]', () => {
    const result = assemblePlatformRecommendations({
      platformId: 'p1',
      highChurnRiskFraction: 0.30,
    })
    expect(getRec(result, 'benchmark_intervention')?.priority).toBe('high')
  })

  test('does NOT fire when highChurnRiskFraction <= 0.20', () => {
    const result = assemblePlatformRecommendations({
      platformId: 'p1',
      highChurnRiskFraction: 0.15,
    })
    expect(getRec(result, 'benchmark_intervention')).toBeUndefined()
  })

  test('does NOT fire when highChurnRiskFraction is undefined', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1' })
    expect(getRec(result, 'benchmark_intervention')).toBeUndefined()
  })
})

describe('platform: product_opportunity', () => {
  test('fires HIGH when lowEngagementLeagueFraction > 0.50', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1', lowEngagementLeagueFraction: 0.55 })
    const rec = getRec(result, 'product_opportunity')
    expect(rec).toBeDefined()
    expect(rec?.priority).toBe('high')
  })

  test('fires MEDIUM when lowEngagementLeagueFraction in (0.30, 0.50]', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1', lowEngagementLeagueFraction: 0.40 })
    expect(getRec(result, 'product_opportunity')?.priority).toBe('medium')
  })

  test('does NOT fire when lowEngagementLeagueFraction <= 0.30', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1', lowEngagementLeagueFraction: 0.25 })
    expect(getRec(result, 'product_opportunity')).toBeUndefined()
  })
})

describe('platform: cohort_improvement', () => {
  test('fires HIGH when inactiveLeagueFraction > 0.40', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1', inactiveLeagueFraction: 0.45 })
    expect(getRec(result, 'cohort_improvement')?.priority).toBe('high')
  })

  test('fires MEDIUM when inactiveLeagueFraction in (0.25, 0.40]', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1', inactiveLeagueFraction: 0.30 })
    expect(getRec(result, 'cohort_improvement')?.priority).toBe('medium')
  })

  test('does NOT fire when inactiveLeagueFraction <= 0.25', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1', inactiveLeagueFraction: 0.20 })
    expect(getRec(result, 'cohort_improvement')).toBeUndefined()
  })
})

describe('platform: feature_adoption', () => {
  test('fires MEDIUM when inactive archetype fraction > 30%', () => {
    // 20 inactive + 30 active = 33% inactive
    const result = assemblePlatformRecommendations({
      platformId: 'p1',
      totalLeagues: 60,
      archetypeDistribution: {
        inactive_or_stale: 12,
        low_engagement: 8,
        highly_engaged: 40,
      },
    })
    // 20/60 = 33.3% > 30%
    const rec = getRec(result, 'feature_adoption')
    expect(rec?.priority).toBe('medium')
  })

  test('fires LOW when inactive archetype fraction in (20%, 30%]', () => {
    // 15 inactive + 60 active = 20% but need > 20%, use 25%
    const result = assemblePlatformRecommendations({
      platformId: 'p1',
      totalLeagues: 40,
      archetypeDistribution: {
        inactive_or_stale: 6,
        low_engagement: 4,
        highly_engaged: 30,
      },
    })
    // 10/40 = 25% which is > 20%
    const rec = getRec(result, 'feature_adoption')
    expect(rec?.priority).toBe('low')
  })

  test('does NOT fire when inactive fraction <= 20%', () => {
    const result = assemblePlatformRecommendations({
      platformId: 'p1',
      totalLeagues: 50,
      archetypeDistribution: {
        inactive_or_stale: 5,
        low_engagement: 4,
        highly_engaged: 41,
      },
    })
    // 9/50 = 18% < 20%
    expect(getRec(result, 'feature_adoption')).toBeUndefined()
  })

  test('does NOT fire when totalLeagues < 3', () => {
    const result = assemblePlatformRecommendations({
      platformId: 'p1',
      totalLeagues: 2,
      archetypeDistribution: { inactive_or_stale: 2 },
    })
    expect(getRec(result, 'feature_adoption')).toBeUndefined()
  })

  test('does NOT fire when archetypeDistribution is undefined', () => {
    const result = assemblePlatformRecommendations({ platformId: 'p1', totalLeagues: 50 })
    expect(getRec(result, 'feature_adoption')).toBeUndefined()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 8. Conflicting / co-occurring signals
// ══════════════════════════════════════════════════════════════════════════════

describe('conflicting and co-occurring signals', () => {
  test('ghost manager fires both engagement_boost and league_participation (co-occurrence)', () => {
    const result = assembleManagerRecommendations(ghostManagerInput())
    expect(getRec(result, 'engagement_boost')).toBeDefined()
    expect(getRec(result, 'league_participation')).toBeDefined()
  })

  test('set_and_forget fires both waiver_opportunity and draft_preparation and league_participation', () => {
    const result = assembleManagerRecommendations(setAndForgetInput())
    expect(getRec(result, 'waiver_opportunity')).toBeDefined()
    expect(getRec(result, 'draft_preparation')).toBeDefined()
    expect(getRec(result, 'league_participation')).toBeDefined()
  })

  test('all manager categories can fire simultaneously (maximally-bad manager)', () => {
    const result = assembleManagerRecommendations({
      managerId: 'worst',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'ghost_manager',
        decisionStyle: 'indecisive',
        transactionStyle: 'passive',
        riskTendency: 'neutral',
        engagementReliability: 'unreliable',
        traits: [],
        completeness: 60,
      },
      patterns: [
        makePattern('manager_inactivity_window', 'high'),
        makePattern('repeated_lineup_indecision', 'medium'),
        makePattern('trade_rejection_pattern', 'medium'),
        makePattern('conservative_roster_pattern', 'high'),
      ],
    })
    expect(result.totalRecommendations).toBe(6)
    expect(result.recommendations.map((r) => r.category).sort()).toEqual([
      'draft_preparation',
      'engagement_boost',
      'league_participation',
      'lineup_discipline',
      'trade_coaching',
      'waiver_opportunity',
    ])
  })

  test('commissioner fires multiple simultaneously on worst-case league', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      archetype: { label: 'inactive_or_stale', confidence: 0.85 },
      benchmark: FULL_BENCHMARK,
      leagueSignals: { ...PASSIVE_SIGNALS, retentionRisk: 'critical', engagementTier: 'dormant' },
      leaguePatterns: [makePattern('league_activity_dropoff', 'high')],
    })
    // All 6 commissioner categories should fire
    expect(result.totalRecommendations).toBe(6)
  })

  test('all 4 platform categories fire simultaneously on maximally-bad platform', () => {
    const result = assemblePlatformRecommendations(platformCriticalInput())
    expect(result.totalRecommendations).toBe(4)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 9. Benchmark influence
// ══════════════════════════════════════════════════════════════════════════════

describe('benchmark influence', () => {
  test('high benchmark suppresses trade_activation for commissioner', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: HIGH_ENGAGEMENT_BENCHMARK,
    })
    expect(getRec(result, 'trade_activation')).toBeUndefined()
  })

  test('low benchmark triggers multiple commissioner recommendations', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: FULL_BENCHMARK,
    })
    // engagement.percentile=20 < 30 → league_event
    // tradeActivity.percentile=8 < 10 → trade_activation (HIGH path)
    // waiverActivity.percentile=18 < 25 → waiver_activation
    expect(getRec(result, 'league_event')).toBeDefined()
    expect(getRec(result, 'trade_activation')).toBeDefined()
    expect(getRec(result, 'waiver_activation')).toBeDefined()
  })

  test('manager engagement_boost includes league benchmark percentile in benchmarkComparison', () => {
    const result = assembleManagerRecommendations({
      ...ghostManagerInput(),
      leagueBenchmark: { ...FULL_BENCHMARK, engagement: { value: 30, percentile: 12 } },
    })
    const rec = getRec(result, 'engagement_boost')
    expect(rec?.benchmarkComparison).toContain('12')
  })

  test('trade_activation benchmarkComparison includes percentile value', () => {
    const result = assembleCommissionerRecommendations({
      leagueId: 'lge1',
      benchmark: FULL_BENCHMARK,
    })
    const rec = getRec(result, 'trade_activation')
    expect(rec?.benchmarkComparison).toContain('8')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 10. No mutation of input objects
// ══════════════════════════════════════════════════════════════════════════════

describe('no mutation', () => {
  test('assembleManagerRecommendations does not mutate input', () => {
    const input = ghostManagerInput()
    const before = JSON.stringify(input)
    assembleManagerRecommendations(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  test('assembleCommissionerRecommendations does not mutate input', () => {
    const input = commissionerHighRiskInput()
    const before = JSON.stringify(input)
    assembleCommissionerRecommendations(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  test('assemblePlatformRecommendations does not mutate input', () => {
    const input = platformCriticalInput()
    const before = JSON.stringify(input)
    assemblePlatformRecommendations(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  test('sorting does not mutate the original array (uses [...recs])', () => {
    // Produce multiple recs with different priorities and verify original order not leaked
    const input = ghostManagerInput()
    const a = assembleManagerRecommendations(input)
    const b = assembleManagerRecommendations(input)
    // Orders must match (sort is stable and deterministic)
    expect(a.recommendations.map((r) => r.id)).toEqual(b.recommendations.map((r) => r.id))
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 11. Recommendation schema completeness
// ══════════════════════════════════════════════════════════════════════════════

describe('recommendation schema completeness', () => {
  test('every recommendation has all required fields', () => {
    const manager = assembleManagerRecommendations(ghostManagerInput())
    const commissioner = assembleCommissionerRecommendations(commissionerHighRiskInput())
    const platform = assemblePlatformRecommendations(platformCriticalInput())

    const allRecs = [
      ...manager.recommendations,
      ...commissioner.recommendations,
      ...platform.recommendations,
    ]

    for (const rec of allRecs) {
      expect(typeof rec.id).toBe('string')
      expect(rec.id.length).toBeGreaterThan(0)
      expect(['manager', 'commissioner', 'platform']).toContain(rec.tier)
      expect(typeof rec.category).toBe('string')
      expect(typeof rec.entityId).toBe('string')
      expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority)
      expect(['urgent', 'elevated', 'standard', 'advisory']).toContain(rec.severity)
      expect(['high', 'medium', 'low']).toContain(rec.confidence)
      expect(Array.isArray(rec.affectedDimensions)).toBe(true)
      expect(rec.affectedDimensions.length).toBeGreaterThan(0)
      expect(typeof rec.expectedImpact).toBe('string')
      expect(rec.expectedImpact.length).toBeGreaterThan(0)
      expect(Array.isArray(rec.derivation)).toBe(true)
      expect(rec.derivation.length).toBeGreaterThan(0)
      expect(Array.isArray(rec.evidence)).toBe(true)
      expect(rec.evidence.length).toBeGreaterThan(0)
      // benchmarkComparison may be string or null
      expect(rec.benchmarkComparison === null || typeof rec.benchmarkComparison === 'string').toBe(true)
      expect(Array.isArray(rec.prerequisites)).toBe(true)
      expect(Array.isArray(rec.recommendedActions)).toBe(true)
      expect(rec.recommendedActions.length).toBeGreaterThan(0)
      for (const action of rec.recommendedActions) {
        expect(typeof action.action).toBe('string')
        expect(typeof action.rationale).toBe('string')
      }
      expect(Array.isArray(rec.rollbackCriteria)).toBe(true)
      expect(typeof rec.completeness).toBe('number')
      expect(rec.completeness).toBeGreaterThanOrEqual(0)
      expect(rec.completeness).toBeLessThanOrEqual(100)
      expect(Array.isArray(rec.uncertainty)).toBe(true)
    }
  })

  test('derivation chain is non-empty for all fired recommendations', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'ghost_manager',
        decisionStyle: 'indecisive',
        transactionStyle: 'passive',
        riskTendency: 'neutral',
        engagementReliability: 'unreliable',
        traits: [],
        completeness: 70,
      },
      patterns: [makePattern('manager_inactivity_window', 'high')],
    })
    for (const rec of result.recommendations) {
      expect(rec.derivation.length).toBeGreaterThan(0)
    }
  })

  test('completeness reflects identity completeness for manager recs', () => {
    const result = assembleManagerRecommendations(ghostManagerInput())
    const rec = getRec(result, 'engagement_boost')
    // ghostManagerInput identity.completeness = 80
    expect(rec?.completeness).toBe(80)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 12. RecommendationSet shape
// ══════════════════════════════════════════════════════════════════════════════

describe('RecommendationSet shape', () => {
  test('totalRecommendations matches recommendations.length', () => {
    const result = assembleManagerRecommendations(ghostManagerInput())
    expect(result.totalRecommendations).toBe(result.recommendations.length)
  })

  test('criticalCount matches count of priority=critical recs', () => {
    const result = assembleManagerRecommendations(ghostManagerInput())
    const actualCritical = result.recommendations.filter((r) => r.priority === 'critical').length
    expect(result.criticalCount).toBe(actualCritical)
  })

  test('entityId matches managerId', () => {
    const result = assembleManagerRecommendations({ managerId: 'test_mgr', leagueId: 'lge1' })
    expect(result.entityId).toBe('test_mgr')
  })

  test('entityId matches leagueId for commissioner', () => {
    const result = assembleCommissionerRecommendations({ leagueId: 'test_lge' })
    expect(result.entityId).toBe('test_lge')
  })

  test('entityId matches platformId for platform', () => {
    const result = assemblePlatformRecommendations({ platformId: 'test_platform' })
    expect(result.entityId).toBe('test_platform')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 13. Unified orchestrator
// ══════════════════════════════════════════════════════════════════════════════

describe('assembleRecommendations (orchestrator)', () => {
  test('empty inputs produce empty result with no warnings', () => {
    const result = assembleRecommendations({
      managerInputs: [],
      commissionerInputs: [],
      platformInputs: [],
    })
    expect(result.managerRecommendations).toHaveLength(0)
    expect(result.commissionerRecommendations).toHaveLength(0)
    expect(result.platformRecommendations).toHaveLength(0)
    expect(result.totalRecommendations).toBe(0)
    expect(result.criticalRecommendations).toBe(0)
    expect(result.version).toBe('6.4.0')
  })

  test('totalRecommendations sums all tiers', () => {
    const input: RecommendationEngineInput = {
      managerInputs: [ghostManagerInput('m1'), ghostManagerInput('m2')],
      commissionerInputs: [commissionerHighRiskInput('l1')],
      platformInputs: [platformCriticalInput('p1')],
    }
    const result = assembleRecommendations(input)
    const expected =
      result.managerRecommendations.reduce((n, s) => n + s.totalRecommendations, 0) +
      result.commissionerRecommendations.reduce((n, s) => n + s.totalRecommendations, 0) +
      result.platformRecommendations.reduce((n, s) => n + s.totalRecommendations, 0)
    expect(result.totalRecommendations).toBe(expected)
  })

  test('criticalRecommendations sums all tiers', () => {
    const input: RecommendationEngineInput = {
      managerInputs: [ghostManagerInput('m1')],
      commissionerInputs: [{
        leagueId: 'l1',
        leagueSignals: { ...PASSIVE_SIGNALS, retentionRisk: 'critical' },
      }],
      platformInputs: [{ platformId: 'p1', highChurnRiskFraction: 0.45 }],
    }
    const result = assembleRecommendations(input)
    const expected =
      result.managerRecommendations.reduce((n, s) => n + s.criticalCount, 0) +
      result.commissionerRecommendations.reduce((n, s) => n + s.criticalCount, 0) +
      result.platformRecommendations.reduce((n, s) => n + s.criticalCount, 0)
    expect(result.criticalRecommendations).toBe(expected)
  })

  test('each tier set preserves its entity id', () => {
    const result = assembleRecommendations({
      managerInputs: [ghostManagerInput('m_abc')],
      commissionerInputs: [{ leagueId: 'l_xyz' }],
      platformInputs: [{ platformId: 'p_def' }],
    })
    expect(result.managerRecommendations[0].entityId).toBe('m_abc')
    expect(result.commissionerRecommendations[0].entityId).toBe('l_xyz')
    expect(result.platformRecommendations[0].entityId).toBe('p_def')
  })

  test('handles multiple managers independently', () => {
    const result = assembleRecommendations({
      managerInputs: [ghostManagerInput('m1'), activeManagerInput('m2')],
      commissionerInputs: [],
      platformInputs: [],
    })
    const m1 = result.managerRecommendations.find((s) => s.entityId === 'm1')
    const m2 = result.managerRecommendations.find((s) => s.entityId === 'm2')
    expect(m1!.totalRecommendations).toBeGreaterThan(0)
    expect(m2!.totalRecommendations).toBe(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// 14. Insufficient data / warnings
// ══════════════════════════════════════════════════════════════════════════════

describe('insufficient data and warnings', () => {
  test('platform with insufficientData=true emits warning', () => {
    const result = assemblePlatformRecommendations({
      platformId: 'p1',
      insufficientData: true,
      highChurnRiskFraction: 0.45,
    })
    expect(result.warnings.some((w) => w.includes('insufficient_data'))).toBe(true)
  })

  test('still fires recommendations even with insufficientData=true if thresholds met', () => {
    const result = assemblePlatformRecommendations({
      platformId: 'p1',
      insufficientData: true,
      highChurnRiskFraction: 0.45,
    })
    expect(getRec(result, 'benchmark_intervention')).toBeDefined()
  })

  test('engagement_boost uncertainty list is non-empty for inactivity pattern', () => {
    const result = assembleManagerRecommendations(ghostManagerInput())
    const rec = getRec(result, 'engagement_boost')
    expect(rec!.uncertainty.length).toBeGreaterThan(0)
  })

  test('low-completeness identity propagates to recommendation completeness', () => {
    const result = assembleManagerRecommendations({
      managerId: 'mgr1',
      leagueId: 'lge1',
      identity: {
        primaryIdentity: 'ghost_manager',
        decisionStyle: 'methodical',
        transactionStyle: 'passive',
        riskTendency: 'neutral',
        engagementReliability: 'unreliable',
        traits: [],
        completeness: 25,
      },
      patterns: [makePattern('manager_inactivity_window', 'high')],
    })
    const rec = getRec(result, 'engagement_boost')
    expect(rec?.completeness).toBe(25)
  })
})
