import { describe, expect, it } from 'vitest'
import {
  computeChimmyConfidenceRubric,
  confidenceLevelFor,
  TRACK_RECORD_MAX_DELTA,
  type ChimmyConfidenceSignals,
} from '@/lib/chimmy-chat/confidence-rubric'
import { buildChimmyAnswerContract } from '@/lib/chimmy-chat/response-contract'

/**
 * Chimmy's track record as a bounded modifier on the confidence it shows (brief items 7 + 10).
 */

// Scores 70 + 10 (league) + 3 (one source) = 83 → high before any track record.
const SIGNALS: ChimmyConfidenceSignals = {
  modelReportedPct: null,
  hasStalenessWarning: false,
  staleMinutes: null,
  thresholdMinutes: null,
  hasLeagueContext: true,
  dataSourceCount: 1,
  sourceLinkCount: 0,
  responseStructurePopulated: {
    shortAnswer: false,
    whatDataSays: false,
    whatItMeans: false,
    recommendedAction: false,
    caveatsCount: 0,
  },
  answerType: 'start_sit',
}

describe('confidenceLevelFor', () => {
  it('is the rubric’s band rule', () => {
    expect([confidenceLevelFor(82), confidenceLevelFor(81.9), confidenceLevelFor(62), confidenceLevelFor(61)]).toEqual([
      'high',
      'medium',
      'medium',
      'low',
    ])
  })
})

describe('track record in the rubric', () => {
  const base = computeChimmyConfidenceRubric(SIGNALS)

  it('changes nothing without a record', () => {
    expect(base.score).toBe(83)
    expect(base.breakdown).not.toHaveProperty('trackRecord')
    expect(computeChimmyConfidenceRubric({ ...SIGNALS, trackRecord: {} }).score).toBe(83)
  })

  it('lowers the score when calls shown at this band were right less often than shown', () => {
    const r = computeChimmyConfidenceRubric({
      ...SIGNALS,
      trackRecord: { high: { observedRate: 0.8, shownRate: 0.9, n: 40 } },
    })
    // (0.8 - 0.9) * 100 * 0.5 = -5
    expect(r.breakdown.trackRecord).toBe(-5)
    expect(r.score).toBe(78)
    expect(r.level).toBe('medium')
    expect(r.rationale).toContain('right 80% of the time (40 checked)')
  })

  it('raises it when they did better, and names that as a positive signal', () => {
    const r = computeChimmyConfidenceRubric({
      ...SIGNALS,
      trackRecord: { high: { observedRate: 0.96, shownRate: 0.88, n: 30 } },
    })
    expect(r.breakdown.trackRecord).toBe(4)
    expect(r.positiveSignals).toContain('track_record')
  })

  it('never moves the score more than the cap', () => {
    const r = computeChimmyConfidenceRubric({
      ...SIGNALS,
      trackRecord: { high: { observedRate: 0.1, shownRate: 0.9, n: 500 } },
    })
    expect(r.breakdown.trackRecord).toBe(-TRACK_RECORD_MAX_DELTA)
  })

  it('reads the band this answer would have been shown at, not another', () => {
    const r = computeChimmyConfidenceRubric({
      ...SIGNALS,
      trackRecord: { medium: { observedRate: 0.1, shownRate: 0.7, n: 100 } },
    })
    expect(r.score).toBe(83)
    expect(r.breakdown).not.toHaveProperty('trackRecord')
  })

  it('ignores a band with no calls or nonsense rates', () => {
    for (const band of [
      { observedRate: 0.1, shownRate: 0.9, n: 0 },
      { observedRate: Number.NaN, shownRate: 0.9, n: 30 },
    ]) {
      expect(computeChimmyConfidenceRubric({ ...SIGNALS, trackRecord: { high: band } }).score).toBe(83)
    }
  })
})

describe('buildChimmyAnswerContract', () => {
  const trackRecords = { start_sit: { high: { observedRate: 0.1, shownRate: 0.9, n: 100 } } }
  const args = {
    hasLeagueContext: true,
    dataSources: ['rosters'],
    trackRecords,
  }

  it('applies the record to a start/sit answer', () => {
    const withRecord = buildChimmyAnswerContract({ ...args, message: 'Should I start Jaylen Waddle or DK Metcalf?', insightType: 'start_sit' })
    const without = buildChimmyAnswerContract({ ...args, trackRecords: null, message: 'Should I start Jaylen Waddle or DK Metcalf?', insightType: 'start_sit' })
    expect(withRecord.contract.answerType).toBe('start_sit')
    expect(withRecord.contract.confidence.level).not.toBe(without.contract.confidence.level)
  })

  it('does not apply a start/sit record to any other answer', () => {
    const a = buildChimmyAnswerContract({ ...args, message: 'Is this trade fair?', insightType: 'trade' })
    const b = buildChimmyAnswerContract({ ...args, trackRecords: null, message: 'Is this trade fair?', insightType: 'trade' })
    expect(a.contract.answerType).toBe('trade')
    expect(a.contract.confidence).toEqual(b.contract.confidence)
  })
})
