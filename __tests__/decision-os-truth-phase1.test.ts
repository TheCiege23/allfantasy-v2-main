import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { computeMatchupWinProbability } from '@/lib/matchup-center/winProbability'
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

  it('PortfolioAnalytics never renders a fabricated 50% probability', () => {
    const src = read('app/dashboard/universal/components/PortfolioAnalytics.tsx')
    expect(src).not.toContain('?? 50')
    expect(src).toContain('Win probability unavailable')
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
