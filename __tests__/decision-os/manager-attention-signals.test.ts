/**
 * Fantasy OS Suite — Phase OS-C1: Manager Operating System Foundation.
 *
 * `deriveManagerAttentionSignals` is pure/zero-I/O like its league-level sibling
 * `deriveLeagueAttentionSignals` — no Prisma or Decision OS resolver mocking needed. Covers the
 * engagement-risk gate (never fires on healthy/low-risk data), severity reuse from
 * `ManagerRetentionRisk`/`RecommendationPriority` verbatim, and id determinism.
 */
import { describe, expect, it } from 'vitest'
import {
  SEVERITY_RANK,
  deriveManagerAttentionSignals,
  type ManagerAttentionSignalInputs,
} from '@/lib/decision-os/attentionSignals'
import type { Recommendation } from '@/lib/decision-os/phase6/recommendations/types'

const NOW = new Date('2026-07-09T12:00:00Z')

function baseInput(o: Partial<ManagerAttentionSignalInputs> = {}): ManagerAttentionSignalInputs {
  return {
    leagueId: 'L1',
    now: NOW,
    retentionRisk: 'low',
    retentionRiskReasons: [],
    isInactive: false,
    recommendations: [],
    ...o,
  }
}

function recommendation(o: Partial<Recommendation> & Pick<Recommendation, 'id' | 'priority'>): Recommendation {
  return {
    tier: 'manager',
    category: 'engagement_boost',
    entityId: 'manager-1',
    severity: 'standard',
    confidence: 'high',
    affectedDimensions: [],
    expectedImpact: 'Real, deterministic expected-impact text.',
    derivation: [],
    evidence: [],
    benchmarkComparison: null,
    prerequisites: [],
    recommendedActions: [],
    rollbackCriteria: [],
    completeness: 100,
    uncertainty: [],
    ...o,
  }
}

describe('deriveManagerAttentionSignals — manager_engagement_risk', () => {
  it('never fires for low retention risk', () => {
    const signals = deriveManagerAttentionSignals(baseInput({ retentionRisk: 'low' }))
    expect(signals.find((s) => s.type === 'manager_engagement_risk')).toBeUndefined()
  })

  it('never fires when retentionRisk is null (UserOsSnapshot unavailable)', () => {
    const signals = deriveManagerAttentionSignals(baseInput({ retentionRisk: null }))
    expect(signals.find((s) => s.type === 'manager_engagement_risk')).toBeUndefined()
  })

  it('fires with critical severity for critical retention risk, reusing that value verbatim', () => {
    const signals = deriveManagerAttentionSignals(baseInput({ retentionRisk: 'critical' }))
    const signal = signals.find((s) => s.type === 'manager_engagement_risk')
    expect(signal?.severity).toBe('critical')
    expect(signal?.priorityScore).toBe(SEVERITY_RANK.critical)
    expect(signal?.source).toBe('user_os')
    expect(signal?.id).toBe('manager_engagement_risk:L1')
  })

  it('includes real retentionRiskReasons in the explanation, never inventing a reason', () => {
    const signals = deriveManagerAttentionSignals(
      baseInput({ retentionRisk: 'high', retentionRiskReasons: ['no lineup activity in 21 days'] }),
    )
    const signal = signals.find((s) => s.type === 'manager_engagement_risk')
    expect(signal?.explanation).toContain('no lineup activity in 21 days')
  })

  it('uses a distinct title for an inactive team vs. a merely at-risk one', () => {
    const inactive = deriveManagerAttentionSignals(baseInput({ retentionRisk: 'medium', isInactive: true }))
    const active = deriveManagerAttentionSignals(baseInput({ retentionRisk: 'medium', isInactive: false }))
    expect(inactive.find((s) => s.type === 'manager_engagement_risk')?.title).toBe('This team has gone inactive')
    expect(active.find((s) => s.type === 'manager_engagement_risk')?.title).toBe(
      "This team's engagement needs attention",
    )
  })
})

describe('deriveManagerAttentionSignals — manager_recommendation', () => {
  it('produces zero signals for zero recommendations', () => {
    const signals = deriveManagerAttentionSignals(baseInput({ recommendations: [] }))
    expect(signals.filter((s) => s.type === 'manager_recommendation')).toHaveLength(0)
  })

  it('produces one signal per recommendation, reusing its own priority as severity verbatim', () => {
    const signals = deriveManagerAttentionSignals(
      baseInput({
        recommendations: [
          recommendation({ id: 'rec-1', priority: 'critical', category: 'lineup_discipline' }),
          recommendation({ id: 'rec-2', priority: 'low', category: 'waiver_opportunity' }),
        ],
      }),
    )
    const recSignals = signals.filter((s) => s.type === 'manager_recommendation')
    expect(recSignals).toHaveLength(2)
    expect(recSignals[0].severity).toBe('critical')
    expect(recSignals[0].id).toBe('manager_recommendation:L1:rec-1')
    expect(recSignals[0].title).toBe('Lineup discipline')
    expect(recSignals[1].severity).toBe('low')
    expect(recSignals[1].title).toBe('Waiver opportunity')
  })

  it('uses the recommendation\'s own real expectedImpact and first recommendedAction, never a fabricated paraphrase', () => {
    const signals = deriveManagerAttentionSignals(
      baseInput({
        recommendations: [
          recommendation({
            id: 'rec-1',
            priority: 'high',
            expectedImpact: 'Setting your lineup improves weekly win probability.',
            recommendedActions: [{ action: 'Start your bench RB over your injured starter.', rationale: 'r' }],
          }),
        ],
      }),
    )
    const signal = signals.find((s) => s.type === 'manager_recommendation')
    expect(signal?.explanation).toBe('Setting your lineup improves weekly win probability.')
    expect(signal?.recommendedAction).toBe('Start your bench RB over your injured starter.')
  })

  it('recommendedAction is null when the recommendation has no recommendedActions', () => {
    const signals = deriveManagerAttentionSignals(
      baseInput({ recommendations: [recommendation({ id: 'rec-1', priority: 'medium', recommendedActions: [] })] }),
    )
    expect(signals.find((s) => s.type === 'manager_recommendation')?.recommendedAction).toBeNull()
  })
})
