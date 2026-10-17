import type { SeasonRules } from './seasonRules'
import { assessSeasonRiNbaCoverage } from './seasonStatAdapter'

/** Frozen-rule source coverage only. A configured API key is not proof of live scoring readiness. */
export function assessSeasonScoringSourceReadiness(rules: SeasonRules) {
  if (rules.sport === 'NFL') return {
    sport: 'NFL' as const, source: 'NFL per-game adapter pending', boxContractReady: false, launchReady: false,
    measured: [] as string[], derived: [] as string[], missing: [] as string[],
    blockers: ['A verified NFL game-level stat adapter and actual kickoff evidence are still required.', 'A complete correction-window worker has not been certified.'],
  }
  const coverage = assessSeasonRiNbaCoverage(rules)
  const missing = [...coverage.needsOtherFeed, ...coverage.unsupported]
  const blockers = [
    ...(coverage.needsOtherFeed.length ? ['Player-level evidence for enabled technical/flagrant foul penalties is not yet certified.'] : []),
    ...(coverage.unsupported.length ? ['Custom weighted stats without a measured provider mapping still need an evidence source.'] : []),
    'Actual game starts and complete correction-window refreshes still need a trusted worker.',
  ]
  return {
    sport: 'NBA' as const, source: 'Rolling Insights NBA box', boxContractReady: missing.length === 0, launchReady: false,
    measured: coverage.measured, derived: coverage.derived, missing, blockers,
  }
}
