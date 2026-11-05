/** Offline calibration analysis. It never changes rules or records acceptance. */
export type CalibrationRow = {
  league: string; season: number; period: number; teamA: string; teamB: string | null;
  scoreA: number; scoreB: number; baseScoreA: number | null; baseScoreB: number | null; configuration: string;
  final: boolean; providerVerified: boolean; lineupComplete: boolean;
  profileMatchesZombie: boolean; correctionHeld: boolean; synthetic: boolean;
}
export type CalibrationMinimums = { matchups: number; periods: number; leagues: number }
/** Analysis screening defaults, not a commissioner acceptance policy. */
export const CALIBRATION_MINIMUMS: CalibrationMinimums = { matchups: 60, periods: 6, leagues: 3 }
export function scoreDistribution(values: readonly number[]) {
  if (!values.length) return null
  if (values.some(v => !Number.isFinite(v))) throw new Error('Finite scores required')
  const sorted = [...values].sort((a, b) => a - b)
  const quantile = (p: number) => {
    const index = (sorted.length - 1) * p, lower = Math.floor(index), weight = index - lower
    return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * weight
  }
  return { count: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: quantile(0.5), p25: quantile(0.25), p75: quantile(0.75), p90: quantile(0.9), min: sorted[0], max: sorted.at(-1)! }
}
export function inspectCalibrationRows(rows: readonly CalibrationRow[]) {
  const reasons: Record<string, number> = {}, keyed = new Map<string, CalibrationRow>(), conflict = new Set<string>()
  const reject = (reason: string) => { reasons[reason] = (reasons[reason] ?? 0) + 1 }
  for (const row of rows) {
    if (!row.league || !Number.isInteger(row.season) || !Number.isInteger(row.period) || row.period < 1 || !row.teamA || !row.teamB || row.teamA === row.teamB) { reject('bye_or_invalid_pairing'); continue }
    if (![row.scoreA, row.scoreB].every(Number.isFinite)) { reject('invalid_score'); continue }
    const key = JSON.stringify([row.league, row.season, row.period, [row.teamA, row.teamB].sort()])
    const old = keyed.get(key)
    if (old) {
      const sameDirection = old.teamA === row.teamA
      if (old.scoreA !== (sameDirection ? row.scoreA : row.scoreB) || old.scoreB !== (sameDirection ? row.scoreB : row.scoreA) || old.baseScoreA !== (sameDirection ? row.baseScoreA : row.baseScoreB) || old.baseScoreB !== (sameDirection ? row.baseScoreB : row.baseScoreA) || old.configuration !== row.configuration || old.final !== row.final || old.providerVerified !== row.providerVerified || old.lineupComplete !== row.lineupComplete || old.profileMatchesZombie !== row.profileMatchesZombie || old.correctionHeld !== row.correctionHeld || old.synthetic !== row.synthetic) conflict.add(key)
      reject('duplicate_pairing'); continue
    }
    keyed.set(key, row)
  }
  const eligible: CalibrationRow[] = [], diagnostic: CalibrationRow[] = []
  for (const [key, row] of keyed) {
    if (conflict.has(key)) { reject('conflicting_pairing'); continue }
    diagnostic.push(row)
    const failures = [!row.final && 'finality_unverified', !row.providerVerified && 'provider_unverified',
      !row.lineupComplete && 'lineup_incomplete_or_unknown', !row.profileMatchesZombie && 'zombie_profile_mismatch_or_unknown',
      !row.configuration && 'configuration_unknown', (row.baseScoreA == null || row.baseScoreB == null || !Number.isFinite(row.baseScoreA) || !Number.isFinite(row.baseScoreB)) && 'base_scores_unverified', row.correctionHeld && 'correction_hold', row.synthetic && 'synthetic']
      .filter((value): value is string => Boolean(value))
    failures.forEach(reject)
    if (!failures.length) eligible.push(row)
  }
  return { inputRows: rows.length, duplicateRows: reasons.duplicate_pairing ?? 0, diagnostic, eligible, reasons }
}
export function calibrationCoverage(rows: readonly CalibrationRow[], minimums = CALIBRATION_MINIMUMS) {
  const inspected = inspectCalibrationRows(rows), eligible = inspected.eligible
  const coverage = { matchups: eligible.filter(r => r.scoreA !== r.scoreB).length, periods: new Set(eligible.map(r => `${r.season}:${r.period}`)).size, leagues: new Set(eligible.map(r => r.league)).size, configurations: new Set(eligible.map(r => r.configuration)).size }
  const blockers: string[] = []
  if (coverage.matchups < minimums.matchups) blockers.push('insufficient_decisive_matchups')
  if (coverage.periods < minimums.periods) blockers.push('insufficient_periods')
  if (coverage.leagues < minimums.leagues) blockers.push('insufficient_leagues')
  if (coverage.configurations !== 1) blockers.push('one_scoring_and_roster_configuration_required')
  return { status: blockers.length ? 'insufficient_evidence' : 'analysis_ready', coverage, minimums, blockers,
    excludedReasons: inspected.reasons, diagnosticRows: inspected.diagnostic.length,
    unknownZeroPairs: inspected.diagnostic.filter(r => r.scoreA === 0 && r.scoreB === 0 && !r.final).length,
    scoreDistribution: scoreDistribution(eligible.flatMap(r => [r.scoreA, r.scoreB])) }
}
/** >= comparison, matching the engine; preserve ties instead of random jitter. */
export function thresholdAtFrequency(values: readonly number[], target: number) {
  if (!values.length || !Number.isFinite(target) || target < 0 || target > 1 || values.some(v => !Number.isFinite(v))) throw new Error('Valid observations and a frequency in [0,1] required')
  const sorted = [...values].sort((a, b) => a - b)
  const candidates = [...new Set(values.map(v => Math.round(v * 100) / 100))]
  candidates.push(Math.max(0.01, Math.round((sorted.at(-1)! + 0.01) * 100) / 100))
  const atLeast = (threshold: number) => {
    let lo = 0, hi = sorted.length
    while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (sorted[mid] < threshold) lo = mid + 1; else hi = mid }
    return (sorted.length - lo) / sorted.length
  }
  const scored = candidates.filter(v => v > 0).map(threshold => ({ threshold, rate: atLeast(threshold) }))
    .sort((a, b) => Math.abs(a.rate - target) - Math.abs(b.rate - target) || b.threshold - a.threshold)
  if (!scored.length) throw new Error('A positive threshold cannot be estimated from this sample')
  return { ...scored[0], target, absoluteError: Math.abs(scored[0].rate - target) }
}
export function proposeFrequencyMatch(reference: readonly CalibrationRow[], target: readonly CalibrationRow[], minimums = CALIBRATION_MINIMUMS) {
  const referenceCoverage = calibrationCoverage(reference, minimums), targetCoverage = calibrationCoverage(target, minimums)
  if (referenceCoverage.status !== 'analysis_ready' || targetCoverage.status !== 'analysis_ready') return { status: 'insufficient_evidence', referenceCoverage, targetCoverage, proposal: null }
  const ref = inspectCalibrationRows(reference).eligible, next = inspectCalibrationRows(target).eligible
  const margins = (rows: CalibrationRow[]) => rows.filter(r => r.scoreA !== r.scoreB).map(r => Math.abs(r.scoreA - r.scoreB))
  const referenceMargins = margins(ref), targetMargins = margins(next)
  const crossingRate = referenceMargins.filter(v => v >= 60).length / referenceMargins.length
  const refScores = ref.flatMap(r => [r.baseScoreA!, r.baseScoreB!]), targetScores = next.flatMap(r => [r.baseScoreA!, r.baseScoreB!])
  return { status: 'proposal_only', referenceCoverage, targetCoverage, proposal: {
    referencePolicy: 'NFL Beta 2025: 60/60 margins; 100/105/110/115/120 score bands',
    combat: thresholdAtFrequency(targetMargins, crossingRate),
    weaponBands: [100, 105, 110, 115, 120].map(line => ({ nflThreshold: line,
      ...thresholdAtFrequency(targetScores, refScores.filter(v => v >= line).length / refScores.length) })),
    requiresItemMechanicsReview: true, applied: false,
    limitation: 'Margin crossings are not role-conditioned combat events. Repeated teams/periods are dependent; this is descriptive screening, not a confidence interval or acceptance signoff.' } }
}
/** A historical raw-score benchmark, explicitly distinct from qualified calibration. */
export function describeMarginCrossings(rows: readonly CalibrationRow[], threshold = 60) {
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('Positive finite margin required')
  const pairs = inspectCalibrationRows(rows).diagnostic, decisive = pairs.filter(r => r.scoreA !== r.scoreB)
  const margins = decisive.map(r => Math.abs(r.scoreA - r.scoreB))
  return { classification: 'descriptive_only', matchups: pairs.length, decisive: decisive.length, ties: pairs.length - decisive.length,
    leagues: new Set(pairs.map(r => r.league)).size, periods: new Set(pairs.map(r => `${r.season}:${r.period}`)).size,
    threshold, crossings: margins.filter(v => v >= threshold).length, rate: margins.length ? margins.filter(v => v >= threshold).length / margins.length : null,
    margins: scoreDistribution(margins), weaponRates: null,
    limitations: ['Raw imported totals may include external adjustments; base player points are unverified.', 'Winner roles and item/serum inventories are not present; this is not an observed combat-event frequency.', 'This benchmark does not approve target thresholds or record acceptance.'] }
}