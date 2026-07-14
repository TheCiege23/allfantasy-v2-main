/**
 * Tests for DivergenceAnalyzer.ts — Trade Shadow Backtest, Phase 6. Pure
 * function tests only; no mocking needed. Fixtures include only the fields
 * summarizeDivergence()/classifyDivergence() actually read.
 */
import { describe, expect, it } from 'vitest'
import type { TradeGraderDivergence, TradeShadowEvaluation } from '@/lib/shared-services/trade/types'
import { classifyDivergence, summarizeDivergence } from '@/lib/shared-services/trade/backtest/DivergenceAnalyzer'
import { DEFAULT_BACKTEST_THRESHOLDS } from '@/lib/shared-services/trade/backtest/types'

function makeDivergence(overrides: Partial<TradeGraderDivergence> = {}): TradeGraderDivergence {
  return {
    graderId: 't2',
    legacyFairnessScore: 90,
    legacyGrade: 'A',
    shadowFairnessScore: 90,
    shadowGrade: 'A',
    fairnessScoreDelta: 0,
    gradeMatches: true,
    notes: [],
    ...overrides,
  }
}

function makeEvaluation(overrides: {
  leagueId?: string
  provider?: string
  confidence?: number
  divergence?: TradeGraderDivergence[]
} = {}): TradeShadowEvaluation {
  return {
    leagueId: overrides.leagueId ?? 'league-1',
    provider: (overrides.provider ?? 'sleeper') as TradeShadowEvaluation['provider'],
    confidence: overrides.confidence ?? 0.8,
    divergence: overrides.divergence ?? [makeDivergence()],
  } as unknown as TradeShadowEvaluation
}

describe('classifyDivergence', () => {
  it('classifies a failed legacy grader call', () => {
    expect(classifyDivergence(makeDivergence({ legacyFairnessScore: null, fairnessScoreDelta: null }), DEFAULT_BACKTEST_THRESHOLDS)).toBe(
      'legacy_grader_failed'
    )
  })

  it('classifies a large delta as critical', () => {
    expect(classifyDivergence(makeDivergence({ fairnessScoreDelta: 35 }), DEFAULT_BACKTEST_THRESHOLDS)).toBe('critical_divergence')
  })

  it('classifies a small nonzero delta as minor', () => {
    expect(classifyDivergence(makeDivergence({ fairnessScoreDelta: 5, gradeMatches: true }), DEFAULT_BACKTEST_THRESHOLDS)).toBe(
      'minor_divergence'
    )
  })

  it('classifies a grade mismatch with zero delta as minor, not aligned', () => {
    expect(classifyDivergence(makeDivergence({ fairnessScoreDelta: 0, gradeMatches: false }), DEFAULT_BACKTEST_THRESHOLDS)).toBe(
      'minor_divergence'
    )
  })

  it('classifies a perfect match as aligned', () => {
    expect(classifyDivergence(makeDivergence({ fairnessScoreDelta: 0, gradeMatches: true }), DEFAULT_BACKTEST_THRESHOLDS)).toBe('aligned')
  })
})

describe('summarizeDivergence', () => {
  it('reports 100% non-critical parity and PASSES when every evaluation aligns', () => {
    const evaluations = [makeEvaluation(), makeEvaluation(), makeEvaluation()]
    const summary = summarizeDivergence(evaluations)

    expect(summary.totalEvaluations).toBe(3)
    expect(summary.byGrader).toHaveLength(1)
    expect(summary.byGrader[0].graderId).toBe('t2')
    expect(summary.byGrader[0].nonCriticalParityRate).toBe(1)
    expect(summary.byGrader[0].criticalDivergenceCount).toBe(0)
    expect(summary.passesMigrationThreshold).toBe(true)
  })

  it('fails the parity threshold when critical divergences push it below the minimum', () => {
    const evaluations = [
      makeEvaluation({ divergence: [makeDivergence({ fairnessScoreDelta: 35 })] }),
      makeEvaluation(),
      makeEvaluation(),
      makeEvaluation(),
    ]
    const summary = summarizeDivergence(evaluations, { ...DEFAULT_BACKTEST_THRESHOLDS, minNonCriticalParityRate: 0.9 })

    expect(summary.byGrader[0].nonCriticalParityRate).toBe(0.75)
    expect(summary.passesMigrationThreshold).toBe(false)
    expect(summary.thresholdFindings[0]).toContain('FAILS')
  })

  it('fails when a critical divergence occurs in a high-confidence evaluation, even under the overall parity threshold', () => {
    const evaluations = Array.from({ length: 20 }, () => makeEvaluation())
    evaluations.push(makeEvaluation({ confidence: 0.9, divergence: [makeDivergence({ fairnessScoreDelta: 40 })] }))
    const summary = summarizeDivergence(evaluations)

    expect(summary.byGrader[0].criticalDivergenceInHighConfidenceCount).toBe(1)
    expect(summary.passesMigrationThreshold).toBe(false)
  })

  it('does not count a legacy-grader failure as a critical divergence', () => {
    const evaluations = [makeEvaluation({ divergence: [makeDivergence({ legacyFairnessScore: null, fairnessScoreDelta: null })] })]
    const summary = summarizeDivergence(evaluations)

    expect(summary.byGrader[0].criticalDivergenceCount).toBe(0)
    expect(summary.byGrader[0].legacyGraderFailedCount).toBe(1)
    expect(summary.byGrader[0].byCategory.legacy_grader_failed).toBe(1)
  })

  it('groups critical divergence counts by league, provider, and confidence bucket', () => {
    const evaluations = [
      makeEvaluation({ leagueId: 'league-a', provider: 'sleeper', confidence: 0.9, divergence: [makeDivergence({ fairnessScoreDelta: 40 })] }),
      makeEvaluation({ leagueId: 'league-b', provider: 'espn', confidence: 0.3 }),
    ]
    const summary = summarizeDivergence(evaluations)

    expect(summary.byLeague['league-a']).toEqual({ totalEvaluations: 1, criticalDivergenceCount: 1 })
    expect(summary.byLeague['league-b']).toEqual({ totalEvaluations: 1, criticalDivergenceCount: 0 })
    expect(summary.byProvider['sleeper']).toEqual({ totalEvaluations: 1, criticalDivergenceCount: 1 })
    expect(summary.byProvider['espn']).toEqual({ totalEvaluations: 1, criticalDivergenceCount: 0 })
    expect(summary.byConfidenceBucket.high).toEqual({ totalEvaluations: 1, criticalDivergenceCount: 1 })
    expect(summary.byConfidenceBucket.low).toEqual({ totalEvaluations: 1, criticalDivergenceCount: 0 })
  })

  it('handles an empty evaluation set cleanly, with no false PASS', () => {
    const summary = summarizeDivergence([])
    expect(summary.totalEvaluations).toBe(0)
    expect(summary.byGrader).toEqual([])
    expect(summary.passesMigrationThreshold).toBe(false)
    expect(summary.thresholdFindings).toEqual(['No divergence data collected — cannot evaluate migration threshold.'])
  })

  it('handles multiple graders independently', () => {
    const evaluations = [
      makeEvaluation({
        divergence: [makeDivergence({ graderId: 't2' }), makeDivergence({ graderId: 'trade_engine', fairnessScoreDelta: 40 })],
      }),
    ]
    const summary = summarizeDivergence(evaluations)

    const t2 = summary.byGrader.find((g) => g.graderId === 't2')
    const tradeEngine = summary.byGrader.find((g) => g.graderId === 'trade_engine')
    expect(t2?.criticalDivergenceCount).toBe(0)
    expect(tradeEngine?.criticalDivergenceCount).toBe(1)
  })
})
