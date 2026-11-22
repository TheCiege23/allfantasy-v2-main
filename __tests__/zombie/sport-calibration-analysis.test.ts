// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { calibrationCoverage, describeMarginCrossings, inspectCalibrationRows, proposeFrequencyMatch, scoreDistribution, thresholdAtFrequency, type CalibrationRow } from '@/lib/zombie/sportCalibration'
const row = (extra: Partial<CalibrationRow> = {}): CalibrationRow => ({ league: 'fixture', season: 2025, period: 1, teamA: 'a', teamB: 'b', scoreA: 120, scoreB: 60, baseScoreA: 120, baseScoreB: 60, configuration: 'one-profile', final: true, providerVerified: true, lineupComplete: true, profileMatchesZombie: true, correctionHeld: false, synthetic: false, ...extra })
describe('offline sport calibration safeguards; fixtures never establish real acceptance', () => {
  it('keeps legitimate final zero scores but rejects unverified scheduled zero pairs', () => {
    expect(inspectCalibrationRows([row({ scoreA: 0, scoreB: 0 })]).eligible).toHaveLength(1)
    const report = calibrationCoverage([row({ scoreA: 0, scoreB: 0, final: false })])
    expect(report.unknownZeroPairs).toBe(1); expect(report.coverage.matchups).toBe(0)
  })
  it('deduplicates mirrored pairings rather than doubling the sample', () => {
    const result = inspectCalibrationRows([row(), row({ teamA: 'b', teamB: 'a', scoreA: 60, scoreB: 120, baseScoreA: 60, baseScoreB: 120 })])
    expect(result.eligible).toHaveLength(1); expect(result.duplicateRows).toBe(1)
  })
  it('quarantines conflicting scores and conflicting finality in duplicates', () => {
    expect(inspectCalibrationRows([row(), row({ scoreB: 61 })]).eligible).toHaveLength(0)
    expect(inspectCalibrationRows([row(), row({ final: false })]).reasons.conflicting_pairing).toBe(1)
  })
  it('rejects byes, median self-pairings and invalid scores', () => {
    const result = inspectCalibrationRows([row({ teamB: null }), row({ teamB: 'a' }), row({ scoreA: NaN })])
    expect(result.eligible).toEqual([]); expect(result.reasons.bye_or_invalid_pairing).toBe(2)
  })
  it.each(['providerVerified', 'lineupComplete', 'profileMatchesZombie'] as const)('requires %s evidence', flag => {
    expect(inspectCalibrationRows([row({ [flag]: false })]).eligible).toEqual([])
  })
  it('excludes synthetic samples and correction holds', () => {
    expect(inspectCalibrationRows([row({ synthetic: true })]).eligible).toEqual([])
    expect(inspectCalibrationRows([row({ correctionHeld: true })]).eligible).toEqual([])
  })
  it('does not pool incompatible scoring/roster configurations into a proposal', () => {
    const rows = [row(), row({ period: 2, configuration: 'different' })]
    expect(calibrationCoverage(rows, { matchups: 1, periods: 1, leagues: 1 }).blockers).toContain('one_scoring_and_roster_configuration_required')
  })
  it('reports mean and interpolated median and preserves genuine outliers', () => {
    expect(scoreDistribution([1, 2, 3, 100])).toMatchObject({ mean: 26.5, median: 2.5, max: 100 })
    expect(scoreDistribution([])).toBeNull()
  })
  it('handles threshold ties deterministically with an explicit achieved rate', () => {
    expect(thresholdAtFrequency([10, 10, 20, 30], 0.5)).toMatchObject({ threshold: 20, rate: 0.5 })
    expect(thresholdAtFrequency([10, 10, 10], 0.5).absoluteError).toBe(0.5)
    expect(() => thresholdAtFrequency([], 0.5)).toThrow()
  })
  it('uses the approved 60-point NFL baseline rather than the old 30/50', () => {
    const reference = [row(), row({ period: 2, scoreA: 100, scoreB: 70 })]
    const target = [row({ scoreA: 1200, scoreB: 600 }), row({ period: 2, scoreA: 1000, scoreB: 700 })]
    const result = proposeFrequencyMatch(reference, target, { matchups: 2, periods: 2, leagues: 1 })
    expect(result.proposal?.combat).toMatchObject({ target: 0.5, threshold: 600, rate: 0.5 })
    expect(result.proposal?.applied).toBe(false)
  })
  it('refuses an empty or short sample instead of inventing thresholds', () => {
    expect(proposeFrequencyMatch([], [row()])).toMatchObject({ status: 'insufficient_evidence', proposal: null })
  })
})
describe('historical benchmark boundaries', () => {
  it('keeps seasons distinct and labels imported-score crossings as descriptive only', () => {
    const rows = [row({ season: 2024 }), row({ season: 2025 })]
    expect(inspectCalibrationRows(rows).diagnostic).toHaveLength(2)
    expect(describeMarginCrossings(rows)).toMatchObject({ classification: 'descriptive_only', matchups: 2, periods: 2, rate: 1, weaponRates: null })
  })
  it('requires base points rather than awarding weapon bands from item-boosted totals', () => {
    expect(inspectCalibrationRows([row({ baseScoreA: null })]).eligible).toEqual([])
    const reference = [row({ scoreA: 180, scoreB: 100, baseScoreA: 100, baseScoreB: 90 })]
    const target = [row({ scoreA: 1800, scoreB: 1000, baseScoreA: 1000, baseScoreB: 900 })]
    const proposal = proposeFrequencyMatch(reference, target, { matchups: 1, periods: 1, leagues: 1 }).proposal
    expect(proposal?.weaponBands[0].target).toBe(0.5)
    expect(proposal?.weaponBands[4].target).toBe(0)
  })
})
it('handles warehouse-sized threshold samples without quadratic rescanning or argument overflow', () => {
  const sample = Array.from({ length: 50000 }, (_, i) => i / 100)
  expect(thresholdAtFrequency(sample, 0.1)).toMatchObject({ threshold: 450, rate: 0.1, absoluteError: 0 })
}, 3000)