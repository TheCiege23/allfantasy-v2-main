import { describe, expect, it } from 'vitest'
import type { EvaluatedDraftPickSample, HistoricalDraftPickSample } from '@/lib/shared-services/draft/backtest/types'
import type { DraftEvaluation, DraftGraderDivergence } from '@/lib/shared-services/draft/types'
import {
  classifyDraftDivergence,
  summarizeDraftBacktest,
  summarizeDraftDivergence,
  summarizeDraftRealOutcomeAlignment,
} from '@/lib/shared-services/draft/backtest/DraftDivergenceAnalyzer'

function makeDivergence(overrides: Partial<DraftGraderDivergence> = {}): DraftGraderDivergence {
  return {
    graderId: 'ai_opponent_draft',
    legacyTopPlayerId: 'p1',
    legacyTopPlayerName: 'Player One',
    legacyConfidence: 0.7,
    shadowTopPlayerId: 'p1',
    shadowTopPlayerName: 'Player One',
    shadowConfidence: 82,
    sameTopPlayer: true,
    notes: [],
    ...overrides,
  }
}

function makeEvaluation(overrides: {
  leagueId?: string
  platform?: string
  round?: number
  topCandidate?: DraftEvaluation['topCandidate']
  divergence?: DraftGraderDivergence[]
} = {}): DraftEvaluation {
  return {
    leagueId: overrides.leagueId ?? 'league-1',
    platform: overrides.platform ?? 'sleeper',
    draftState: { round: overrides.round ?? 3, pick: 25, totalTeams: 12, status: 'completed' },
    topCandidate: 'topCandidate' in overrides ? overrides.topCandidate ?? null : { playerId: 'p1', playerName: 'Player One', position: 'RB', team: 'KC' },
    divergence: overrides.divergence ?? [makeDivergence()],
  } as unknown as DraftEvaluation
}

function makeSample(overrides: Partial<HistoricalDraftPickSample> = {}): HistoricalDraftPickSample {
  return {
    sessionId: 'session-1',
    leagueId: 'league-1',
    platform: 'sleeper',
    overall: 25,
    round: 3,
    rosterId: 'roster-1',
    realPlayerId: 'p1',
    realPlayerName: 'Player One',
    realPosition: 'RB',
    ...overrides,
  }
}

describe('classifyDraftDivergence', () => {
  it('classifies a failed legacy grader call', () => {
    expect(classifyDraftDivergence(makeDivergence({ sameTopPlayer: null }))).toBe('legacy_grader_failed')
  })
  it('classifies matching top players as aligned', () => {
    expect(classifyDraftDivergence(makeDivergence({ sameTopPlayer: true }))).toBe('aligned')
  })
  it('classifies mismatched top players as diverged', () => {
    expect(classifyDraftDivergence(makeDivergence({ sameTopPlayer: false }))).toBe('diverged')
  })
})

describe('summarizeDraftDivergence', () => {
  it('reports 100% same-top-player rate when every evaluation aligns', () => {
    const summary = summarizeDraftDivergence([makeEvaluation(), makeEvaluation(), makeEvaluation()])
    expect(summary.totalEvaluations).toBe(3)
    expect(summary.byGrader[0].sameTopPlayerRate).toBe(1)
  })

  it('groups diverged counts by league, provider, and round', () => {
    const summary = summarizeDraftDivergence([
      makeEvaluation({ leagueId: 'league-a', platform: 'sleeper', round: 2, divergence: [makeDivergence({ sameTopPlayer: false })] }),
      makeEvaluation({ leagueId: 'league-b', platform: 'espn', round: 5 }),
    ])
    expect(summary.byLeague['league-a']).toEqual({ totalEvaluations: 1, divergedCount: 1 })
    expect(summary.byLeague['league-b']).toEqual({ totalEvaluations: 1, divergedCount: 0 })
    expect(summary.byProvider['sleeper']).toEqual({ totalEvaluations: 1, divergedCount: 1 })
    expect(summary.byRound[2]).toEqual({ totalEvaluations: 1, divergedCount: 1 })
    expect(summary.byRound[5]).toEqual({ totalEvaluations: 1, divergedCount: 0 })
  })

  it('does not count a legacy-grader failure as a divergence', () => {
    const summary = summarizeDraftDivergence([makeEvaluation({ divergence: [makeDivergence({ sameTopPlayer: null })] })])
    expect(summary.byGrader[0].byCategory.diverged).toBe(0)
    expect(summary.byGrader[0].legacyGraderFailedCount).toBe(1)
  })

  it('handles an empty evaluation set cleanly', () => {
    const summary = summarizeDraftDivergence([])
    expect(summary.totalEvaluations).toBe(0)
    expect(summary.byGrader).toEqual([])
    expect(summary.thresholdFindings).toEqual(['No divergence data collected.'])
  })
})

describe('summarizeDraftRealOutcomeAlignment', () => {
  it('matches by resolved player id', () => {
    const pairs: EvaluatedDraftPickSample[] = [{ sample: makeSample(), evaluation: makeEvaluation() }]
    expect(summarizeDraftRealOutcomeAlignment(pairs)).toEqual({ matchedCount: 1, totalSamples: 1 })
  })

  it('falls back to name+position match when no player id is resolved on either side', () => {
    const pairs: EvaluatedDraftPickSample[] = [
      {
        sample: makeSample({ realPlayerId: null }),
        evaluation: makeEvaluation({ topCandidate: { playerId: null, playerName: 'Player One', position: 'RB', team: 'KC' } }),
      },
    ]
    expect(summarizeDraftRealOutcomeAlignment(pairs)).toEqual({ matchedCount: 1, totalSamples: 1 })
  })

  it('counts a genuine mismatch honestly', () => {
    const pairs: EvaluatedDraftPickSample[] = [
      { sample: makeSample(), evaluation: makeEvaluation({ topCandidate: { playerId: 'p2', playerName: 'Player Two', position: 'WR', team: 'SF' } }) },
    ]
    expect(summarizeDraftRealOutcomeAlignment(pairs)).toEqual({ matchedCount: 0, totalSamples: 1 })
  })

  it('does not count a sample with no shadow top candidate as matched', () => {
    const pairs: EvaluatedDraftPickSample[] = [{ sample: makeSample(), evaluation: makeEvaluation({ topCandidate: null }) }]
    expect(summarizeDraftRealOutcomeAlignment(pairs)).toEqual({ matchedCount: 0, totalSamples: 1 })
  })

  it('handles an empty pair set cleanly', () => {
    expect(summarizeDraftRealOutcomeAlignment([])).toEqual({ matchedCount: 0, totalSamples: 0 })
  })
})

describe('summarizeDraftBacktest', () => {
  it('combines grader parity and real-outcome alignment', () => {
    const pairs: EvaluatedDraftPickSample[] = [{ sample: makeSample(), evaluation: makeEvaluation() }]
    const summary = summarizeDraftBacktest(pairs)
    expect(summary.totalEvaluations).toBe(1)
    expect(summary.realOutcomeAlignment.totalSamples).toBe(1)
  })
})
