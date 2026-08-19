import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  computeMatchupWinProbability,
  formatWinProbabilityPercents,
  winProbabilitySortDistance,
} from '@/lib/matchup-center/winProbability'
import { buildMatchupInsightsBlock } from '@/lib/matchup-center/matchupAiInsights'
import { buildManagerDnaViewModel } from '@/lib/decision-os/manager-dna'
import { buildMinimalValidMatchupCenterPayload } from '@/lib/engine-testing/fixtures/enginePayloadBuilders'

// Decision OS Truth Phase 1: no probability, edge claim, insight, or psychology profile may be
// displayed unless the evidence behind it is real. Missing evidence renders as unavailable.

const read = (path: string) => readFileSync(path, 'utf8')

describe('computeMatchupWinProbability', () => {
  const side = (projectedTotal: number, projectedTotalIncludesFallback = false) => ({
    projectedTotal,
    projectedTotalIncludesFallback,
  })

  it('computes the clamped ratio only when both totals are fully real', () => {
    expect(computeMatchupWinProbability(side(90), side(60))).toBeCloseTo(0.6)
    expect(computeMatchupWinProbability(side(1000), side(1))).toBe(0.95)
    expect(computeMatchupWinProbability(side(1), side(1000))).toBe(0.05)
  })

  it('refuses when either side includes fallback projections', () => {
    expect(computeMatchupWinProbability(side(90, true), side(60))).toBeNull()
    expect(computeMatchupWinProbability(side(90), side(60, true))).toBeNull()
    expect(computeMatchupWinProbability(side(90, true), side(60, true))).toBeNull()
  })

  it('refuses when totals are zero or negative (no evidence)', () => {
    expect(computeMatchupWinProbability(side(0), side(0))).toBeNull()
    expect(computeMatchupWinProbability(side(-5), side(60))).toBeNull()
    expect(computeMatchupWinProbability(side(60), side(-5))).toBeNull()
  })

  it('refuses malformed totals (NaN / Infinity) on either side', () => {
    expect(computeMatchupWinProbability(side(Number.NaN), side(60))).toBeNull()
    expect(computeMatchupWinProbability(side(60), side(Number.NaN))).toBeNull()
    expect(computeMatchupWinProbability(side(Number.POSITIVE_INFINITY), side(60))).toBeNull()
    expect(computeMatchupWinProbability(side(60), side(Number.POSITIVE_INFINITY))).toBeNull()
  })

  it('a true 50/50 is possible only from real evidence', () => {
    expect(computeMatchupWinProbability(side(80), side(80))).toBe(0.5)
    expect(computeMatchupWinProbability(side(80, true), side(80, true))).toBeNull()
  })
})

describe('win-probability rendering unit (0-1 in, integer percents out)', () => {
  it('renders honest percentages on the correct scale', () => {
    expect(formatWinProbabilityPercents(0.5)).toEqual({ leftPct: 50, rightPct: 50 })
    expect(formatWinProbabilityPercents(0.12)).toEqual({ leftPct: 12, rightPct: 88 })
    expect(formatWinProbabilityPercents(0.88)).toEqual({ leftPct: 88, rightPct: 12 })
  })

  it('null never becomes 50/50', () => {
    expect(formatWinProbabilityPercents(null)).toBeNull()
    expect(formatWinProbabilityPercents(Number.NaN)).toBeNull()
  })

  it('sorting uses the same unit as rendering, unknowns last', () => {
    expect(winProbabilitySortDistance(0.5)).toBe(0)
    expect(winProbabilitySortDistance(0.12)).toBe(38)
    expect(winProbabilitySortDistance(0.88)).toBe(38)
    expect(winProbabilitySortDistance(null)).toBe(999)
    // Closer contest sorts first; unknown sorts after every real probability.
    const order = [0.88, null, 0.55, 0.12].sort(
      (a, b) => winProbabilitySortDistance(a) - winProbabilitySortDistance(b)
    )
    expect(order).toEqual([0.55, 0.88, 0.12, null])
  })
})

describe('matchup insights never claim an edge off fallback totals', () => {
  const payloadWith = (leftFallback: boolean, rightFallback: boolean) => {
    const p = buildMinimalValidMatchupCenterPayload()
    return {
      left: { ...p.left, projectedTotal: 100, projectedTotalIncludesFallback: leftFallback },
      right: { ...p.right, projectedTotal: 80, projectedTotalIncludesFallback: rightFallback },
    }
  }

  it('claims a projected edge only from fully real totals', () => {
    const real = buildMatchupInsightsBlock({ ...payloadWith(false, false), sport: 'NFL' })
    expect(real.matchupEdge).toContain('projects ahead by')
  })

  it('declines the edge claim when any starter projection is a fallback', () => {
    const partial = buildMatchupInsightsBlock({ ...payloadWith(true, false), sport: 'NFL' })
    expect(partial.matchupEdge).not.toContain('projects ahead by')
    expect(partial.matchupEdge).toContain('unavailable')
    expect(partial.floorVsCeiling).not.toContain('on paper')
  })
})

describe('manager psychology renders honestly with empty tables', () => {
  it('null source produces an explicit insufficient state with zero fabricated traits', () => {
    const vm = buildManagerDnaViewModel({ source: null, now: new Date('2026-01-01T00:00:00Z') })
    expect(vm.status).toBe('insufficient-data')
    expect(vm.traits).toEqual([])
    expect(vm.insufficientData?.title).toBeTruthy()
    // No invented behavioral claims: styles stay "Pending", not adjectives.
    expect(vm.decisionStyle).toBe('Pending')
    expect(vm.riskTendency).toBe('Pending')
  })
})

describe('source-level fabrication locks', () => {
  it('start/sit no longer invents a default win-probability insight', () => {
    expect(read('lib/ai-matchup-engine/runStartSitAiEngine.ts')).not.toContain(
      'Marginal swing in tight weeks.'
    )
  })

  it('PortfolioAnalytics never renders a fabricated 50% probability and shares the render/sort unit helpers', () => {
    const src = read('app/dashboard/universal/components/PortfolioAnalytics.tsx')
    expect(src).not.toContain('?? 50')
    expect(src).toContain('Win probability unavailable')
    expect(src).toContain('formatWinProbabilityPercents')
    expect(src).toContain('winProbabilitySortDistance')
  })

  it('MatchupHeaderCard shows an honest unavailable state instead of nothing', () => {
    expect(read('components/matchup-center/MatchupHeaderCard.tsx')).toContain(
      'Win probability unavailable'
    )
  })

  it('the service derives per-side fallback flags and gates winProb through the shared helper', () => {
    const src = read('server/services/matchupCenterService.ts')
    expect(src).toContain('projectedTotalIncludesFallback: leftSlots.some((s) => !s.hasRealProjection)')
    expect(src).toContain('computeMatchupWinProbability(left, right)')
  })
})
