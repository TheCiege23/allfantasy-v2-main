/**
 * Fantasy OS Phase 5H-f — production scoring-authority boundary (declaration + future-migration design; pure).
 *
 * INVARIANT (unchanged in 5H-f): certified sports facts ≠ production scoring authority. Certified `sports_data`
 * statistics are OBSERVATIONAL evidence only; projections/valuations/injuries/availability NEVER change fantasy
 * points. The existing production scoring pipeline remains authoritative. This module documents the authoritative
 * flow and the (not-executed) future scoring-authority certification plan; enforcement lives in the boundary test.
 */

/** The authoritative production scoring flow, stage by stage (verified in code, Phase 5H-f audit). */
export const PRODUCTION_SCORING_AUTHORITY = {
  stages: [
    { stage: 'raw_stat_ingest', table: 'PlayerGameLogCache', service: 'lib/sports-os/PlayerGameLogImportService.ts' },
    { stage: 'score_compute', table: 'PlayerWeeklyScore', service: 'lib/redraft/playerWeeklyScoreService.ts → calculateScoreFromSportConfig (lib/redraft/scoringEngine.ts)' },
    { stage: 'matchup_total', table: 'RedraftMatchup', service: 'lib/redraft/scoringEngine.ts::updateMatchupScores' },
    { stage: 'standings', table: 'RedraftRoster / FantasyStanding', service: 'lib/redraft/standingsEngine.ts::updateStandings' },
    { stage: 'finalization', table: 'RedraftMatchup.status + PlayerWeeklyScore.isFinalized', service: 'updateMatchupScores / resolveNflRedraftLiveScoringRuntime' },
  ],
  // Certified sports_data statistics are NOT a scoring input; the only scoring-adjacent use is a gated
  // (FANTASY_OS_SPORTS_DATA_SCORING_ENABLED, default-off) STRICTER-ONLY finality delay that can only set
  // isFinal=false, never supply points, never finalize, and fails open.
  certifiedStatsRole: 'observational-evidence-only (never a scoring input)',
  scoringAuthorityChangedInPhase5Hf: false,
} as const

/** Modules that must NEVER be imported by a production scoring engine (would breach the boundary). */
export const FORBIDDEN_IN_SCORING = [
  'sports-data-gateway/runtime/statisticsRuntime',
  'sports-data-gateway/runtime/certifiedReads',
  'sports-data-gateway/canonical/canonicalValue',
  'sports-data-gateway/canonical/canonicalImage',
  'sports-data-gateway/persistence/canonicalPersistence',
  'sports-data-gateway/persistence/factualDomains',
] as const

/**
 * Future scoring-authority certification plan (DESIGN ONLY — not executed; parity thresholds are TARGETS, NOT passed).
 * A migration would require ALL of these before any production scoring authority could change, behind an explicit gate.
 */
export const FUTURE_SCORING_MIGRATION_REQUIREMENTS = {
  steps: [
    'representative historical backfill', 'sport-by-sport scoring comparison', 'scoring-format coverage',
    'stat correction handling', 'player identity coverage', 'team-defense and IDP coverage', 'official game-final status',
    'duplicate suppression', 'late-stat correction replay', 'matchup-total parity', 'standings parity', 'playoff parity',
    'commissioner override compatibility', 'rollback', 'shadow period', 'explicit production authorization',
  ],
  parityThresholds: {
    gameIdentityMatch: '100%',
    rosteredPlayerIdentityOrExplicitUnsupported: '100%',
    deterministicRerun: '100%',
    duplicateScoringRows: 0,
    projectionOrValueContamination: 0,
    documentedVarianceForEveryMismatchedStat: true,
    unexplainedMatchupTotalDifference: 0,
  },
  status: 'DESIGN_ONLY — thresholds are targets; none claimed passed; no execution authorized in 5H-f',
} as const

/** True if scoring authority is unchanged (always true in 5H-f; asserted by tests + the boundary enforcement test). */
export function isScoringAuthorityUnchanged(): boolean {
  return PRODUCTION_SCORING_AUTHORITY.scoringAuthorityChangedInPhase5Hf === false
}
