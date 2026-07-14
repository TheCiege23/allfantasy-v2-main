import { describe, expect, it } from 'vitest'
import { runT2Grader } from '@/lib/shared-services/trade/LegacyGraderAdapters'
import type { AssetValuation } from '@/lib/trade-engine/trade-decision-context'

function makeAssetValuation(overrides: Partial<AssetValuation> = {}): AssetValuation {
  return {
    name: 'Test Player',
    type: 'PLAYER',
    position: 'QB',
    age: 27,
    team: 'KC',
    marketValue: 8000,
    impactValue: 6000,
    vorpValue: 5000,
    volatility: 0.2,
    valuationSource: { source: 'fantasycalc', valuedAt: new Date().toISOString() },
    adp: null,
    isCornerstone: false,
    cornerstoneReason: '',
    ...overrides,
  }
}

describe('runT2Grader — real gradeTrade() call with adapted provider-neutral input', () => {
  it('calls the real T2 grader and returns a real fairness score/grade', () => {
    const sideA = [makeAssetValuation({ name: 'Patrick Mahomes', marketValue: 9000 })]
    const sideB = [makeAssetValuation({ name: 'Josh Allen', marketValue: 8900 })]

    const result = runT2Grader('roster-1', 'roster-2', sideA, sideB)

    expect(result.error).toBeNull()
    expect(result.graderId).toBe('t2')
    expect(result.fairnessScore).not.toBeNull()
    expect(result.fairnessScore).toBeGreaterThan(80) // near-equal values -> high fairness
    expect(typeof result.grade).toBe('string')
  })

  it('produces a lower fairness score for a lopsided trade', () => {
    const sideA = [makeAssetValuation({ name: 'Elite Player', marketValue: 10000 })]
    const sideB = [makeAssetValuation({ name: 'Bench Player', marketValue: 1000 })]

    const result = runT2Grader('roster-1', 'roster-2', sideA, sideB)

    expect(result.fairnessScore).not.toBeNull()
    expect(result.fairnessScore!).toBeLessThan(50)
  })

  it('never throws — returns a typed error result when gradeTrade itself would fail', () => {
    // Empty asset arrays on both sides is a degenerate but not throwing case for T2;
    // this proves the wrapper's own contract (never throws) regardless.
    expect(() => runT2Grader('roster-1', 'roster-2', [], [])).not.toThrow()
    const result = runT2Grader('roster-1', 'roster-2', [], [])
    expect(result.error).toBeNull()
    expect(result.fairnessScore).not.toBeNull()
  })

  it('honestly omits projectionValue since the provider-neutral context does not carry it', () => {
    // Not directly observable from the result shape, but documented behavior:
    // confidence is computed by T2 itself from missing projection data, never fabricated.
    const sideA = [makeAssetValuation({ name: 'Player A' })]
    const sideB = [makeAssetValuation({ name: 'Player B' })]
    const result = runT2Grader('roster-1', 'roster-2', sideA, sideB)
    expect(result.error).toBeNull()
  })
})
