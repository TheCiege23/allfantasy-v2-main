import { describe, expect, it } from 'vitest'
import type { EvaluatedWaiverSample, HistoricalWaiverSample } from '@/lib/shared-services/waiver/backtest/types'
import type { WaiverEvaluation, WaiverGraderDivergence } from '@/lib/shared-services/waiver/types'
import { classifyWaiverDivergence, summarizeRealOutcomeAlignment, summarizeWaiverBacktest, summarizeWaiverDivergence } from '@/lib/shared-services/waiver/backtest/WaiverDivergenceAnalyzer'

function makeDivergence(overrides: Partial<WaiverGraderDivergence> = {}): WaiverGraderDivergence {
  return {
    graderId: 'waiver_recommendation_service',
    legacyTopAddPlayerId: 'p1',
    legacyTopAddPlayerName: 'Player One',
    legacyFaabBid: 10,
    legacyPriority: 1,
    shadowTopAddPlayerId: 'p1',
    shadowTopAddPlayerName: 'Player One',
    shadowFaabBid: 10,
    shadowPriority: 1,
    sameTopAdd: true,
    faabBidDelta: 0,
    notes: [],
    ...overrides,
  }
}

function makeEvaluation(overrides: { leagueId?: string; platform?: string; topCandidate?: WaiverEvaluation['topCandidate']; divergence?: WaiverGraderDivergence[] } = {}): WaiverEvaluation {
  return {
    leagueId: overrides.leagueId ?? 'league-1',
    platform: overrides.platform ?? 'sleeper',
    topCandidate: overrides.topCandidate ?? { playerId: 'p1', playerName: 'Player One', position: 'RB', team: 'KC' },
    divergence: overrides.divergence ?? [makeDivergence()],
  } as unknown as WaiverEvaluation
}

function makeSample(overrides: Partial<HistoricalWaiverSample> = {}): HistoricalWaiverSample {
  return {
    claimId: 'claim-1',
    leagueId: 'league-1',
    rosterId: 'roster-1',
    platform: 'sleeper',
    managerKey: 'manager-1',
    addPlayerId: 'p1',
    addPlayerName: null,
    dropPlayerId: null,
    faabBid: 10,
    priorityOrder: 1,
    realOutcome: 'awarded',
    realFaabDelta: -10,
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('classifyWaiverDivergence', () => {
  it('classifies a failed legacy grader call', () => {
    expect(classifyWaiverDivergence(makeDivergence({ sameTopAdd: null }))).toBe('legacy_grader_failed')
  })
  it('classifies matching top adds as aligned', () => {
    expect(classifyWaiverDivergence(makeDivergence({ sameTopAdd: true }))).toBe('aligned')
  })
  it('classifies mismatched top adds as diverged', () => {
    expect(classifyWaiverDivergence(makeDivergence({ sameTopAdd: false }))).toBe('diverged')
  })
})

describe('summarizeWaiverDivergence', () => {
  it('reports 100% same-top-add rate when every evaluation aligns', () => {
    const summary = summarizeWaiverDivergence([makeEvaluation(), makeEvaluation(), makeEvaluation()])
    expect(summary.totalEvaluations).toBe(3)
    expect(summary.byGrader[0].sameTopAddRate).toBe(1)
  })

  it('groups diverged counts by league and provider', () => {
    const summary = summarizeWaiverDivergence([
      makeEvaluation({ leagueId: 'league-a', platform: 'sleeper', divergence: [makeDivergence({ sameTopAdd: false })] }),
      makeEvaluation({ leagueId: 'league-b', platform: 'espn' }),
    ])
    expect(summary.byLeague['league-a']).toEqual({ totalEvaluations: 1, divergedCount: 1 })
    expect(summary.byLeague['league-b']).toEqual({ totalEvaluations: 1, divergedCount: 0 })
    expect(summary.byProvider['sleeper']).toEqual({ totalEvaluations: 1, divergedCount: 1 })
    expect(summary.byProvider['espn']).toEqual({ totalEvaluations: 1, divergedCount: 0 })
  })

  it('does not count a legacy-grader failure as a divergence', () => {
    const summary = summarizeWaiverDivergence([makeEvaluation({ divergence: [makeDivergence({ sameTopAdd: null })] })])
    expect(summary.byGrader[0].byCategory.diverged).toBe(0)
    expect(summary.byGrader[0].legacyGraderFailedCount).toBe(1)
  })

  it('handles an empty evaluation set cleanly', () => {
    const summary = summarizeWaiverDivergence([])
    expect(summary.totalEvaluations).toBe(0)
    expect(summary.byGrader).toEqual([])
    expect(summary.thresholdFindings).toEqual(['No divergence data collected.'])
  })
})

describe('summarizeRealOutcomeAlignment', () => {
  it('counts an awarded claim as agreed when the shadow top pick matches the historical add', () => {
    const pairs: EvaluatedWaiverSample[] = [{ sample: makeSample({ realOutcome: 'awarded', addPlayerId: 'p1' }), evaluation: makeEvaluation({ topCandidate: { playerId: 'p1', playerName: 'x', position: 'RB', team: null } }) }]
    const alignment = summarizeRealOutcomeAlignment(pairs)
    expect(alignment).toEqual({ awardedAndShadowAgreed: 1, awardedTotal: 1, failedAndShadowDisagreed: 0, failedTotal: 0 })
  })

  it('counts a failed claim as "shadow disagreed" when the shadow picked someone else', () => {
    const pairs: EvaluatedWaiverSample[] = [{ sample: makeSample({ realOutcome: 'failed', addPlayerId: 'p1' }), evaluation: makeEvaluation({ topCandidate: { playerId: 'p2', playerName: 'y', position: 'WR', team: null } }) }]
    const alignment = summarizeRealOutcomeAlignment(pairs)
    expect(alignment).toEqual({ awardedAndShadowAgreed: 0, awardedTotal: 0, failedAndShadowDisagreed: 1, failedTotal: 1 })
  })

  it('handles an empty pair set cleanly', () => {
    expect(summarizeRealOutcomeAlignment([])).toEqual({ awardedAndShadowAgreed: 0, awardedTotal: 0, failedAndShadowDisagreed: 0, failedTotal: 0 })
  })
})

describe('summarizeWaiverBacktest', () => {
  it('combines grader parity and real-outcome alignment', () => {
    const pairs: EvaluatedWaiverSample[] = [{ sample: makeSample(), evaluation: makeEvaluation() }]
    const summary = summarizeWaiverBacktest(pairs)
    expect(summary.totalEvaluations).toBe(1)
    expect(summary.realOutcomeAlignment.awardedTotal).toBe(1)
  })
})
