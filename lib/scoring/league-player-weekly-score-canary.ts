import type { PlayerWeeklyScoreRollupResult } from '@/lib/scoring/player-weekly-score-rollup'
import type { ShadowPersistResult } from '@/lib/scoring/league-player-weekly-score-store'
import type { StatDriftProbeResult } from '@/lib/scoring/stat-drift-probe'

const DRIFT_THRESHOLD = 0.02

export type LeagueScoreCanarySelectionRequirement =
  | 'standard_scoring_redraft'
  | 'custom_scoring_redraft_if_available'
  | 'has_finalized_matchup'
  | 'has_missing_stats_if_available'
  | 'recent_active_week'

export const LEAGUE_SCORE_CANARY_SELECTION_REQUIREMENTS: LeagueScoreCanarySelectionRequirement[] = [
  'standard_scoring_redraft',
  'custom_scoring_redraft_if_available',
  'has_finalized_matchup',
  'has_missing_stats_if_available',
  'recent_active_week',
]

export type LeagueScoreCanaryDriftSummary = {
  severity: StatDriftProbeResult['severity']
  checkedPlayers: number
  checkedTeams: number
  missingGameStats: number
  missingWeeklyScores: number
  mismatchedPlayers: number
  mismatchedTeams: number
  maxTeamDriftAbs: number
  notes: string[]
}

export type LeagueScoreCanarySummary = {
  leagueId: string
  season: number
  week: number
  generatedAtIso: string
  rollup: Pick<PlayerWeeklyScoreRollupResult, 'candidateRows' | 'missingPlayers' | 'wouldCreate' | 'wouldUpdate' | 'wouldSkip' | 'notes'>
  shadow: ShadowPersistResult
  drift: LeagueScoreCanaryDriftSummary
}

export type LeagueScoreParityGateInput = {
  summary: LeagueScoreCanarySummary
  scoringRulesHashMissingDocumented?: boolean
  expectedMissingPlayerGameStatCount?: number
  expectedDuplicateInputCount?: number
  unexpectedGlobalFallbackCount?: number
}

export type LeagueScoreParityGateFailureCode =
  | 'missing_player_game_stat_unexpected'
  | 'team_drift_above_threshold'
  | 'shadow_write_requested_but_not_applied'
  | 'duplicate_candidate_keys_unexpected'
  | 'scoring_rules_hash_missing_undocumented'
  | 'unexpected_global_fallback'
  | 'ui_score_regression_detected'

export type LeagueScoreParityGateFailure = {
  code: LeagueScoreParityGateFailureCode
  message: string
}

export type LeagueScoreParityGateResult = {
  pass: boolean
  thresholds: {
    teamDriftMaxAbs: number
    expectedMissingPlayerGameStatCount: number
    expectedDuplicateInputCount: number
    unexpectedGlobalFallbackCount: number
  }
  failures: LeagueScoreParityGateFailure[]
}

export function resolveCanaryShadowWrite(input: {
  shadowWrite: boolean
  confirmStaging: boolean
  stagingConfirmed: boolean
}): {
  writeRequested: boolean
  writeAllowed: boolean
  blockedReason: string | null
} {
  const writeRequested = Boolean(input.shadowWrite)
  if (!writeRequested) {
    return {
      writeRequested,
      writeAllowed: false,
      blockedReason: null,
    }
  }
  if (!input.confirmStaging) {
    return {
      writeRequested,
      writeAllowed: false,
      blockedReason: 'confirm_staging_required',
    }
  }
  if (!input.stagingConfirmed) {
    return {
      writeRequested,
      writeAllowed: false,
      blockedReason: 'staging_environment_not_confirmed',
    }
  }
  return {
    writeRequested,
    writeAllowed: true,
    blockedReason: null,
  }
}

export function buildLeagueScoreCanarySummary(input: {
  leagueId: string
  season: number
  week: number
  rollup: PlayerWeeklyScoreRollupResult
  shadow: ShadowPersistResult
  drift: StatDriftProbeResult
}): LeagueScoreCanarySummary {
  const maxTeamDriftAbs = maxAbsTeamDelta(input.drift)
  return {
    leagueId: input.leagueId,
    season: input.season,
    week: input.week,
    generatedAtIso: new Date().toISOString(),
    rollup: {
      candidateRows: input.rollup.candidateRows.length,
      missingPlayers: input.rollup.missingPlayers.length,
      wouldCreate: input.rollup.wouldCreate,
      wouldUpdate: input.rollup.wouldUpdate,
      wouldSkip: input.rollup.wouldSkip,
      notes: input.rollup.notes,
    },
    shadow: input.shadow,
    drift: {
      severity: input.drift.severity,
      checkedPlayers: input.drift.checkedPlayers,
      checkedTeams: input.drift.checkedTeams,
      missingGameStats: input.drift.missingGameStats,
      missingWeeklyScores: input.drift.missingWeeklyScores,
      mismatchedPlayers: input.drift.mismatchedPlayers.length,
      mismatchedTeams: input.drift.mismatchedTeams.length,
      maxTeamDriftAbs,
      notes: input.drift.notes,
    },
  }
}

function maxAbsTeamDelta(input: StatDriftProbeResult): number {
  const deltas = input.mismatchedTeams
    .flatMap((row) => [row.deltaRedraftVsPgs, row.deltaTeamPerfVsPgs])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .map((value) => Math.abs(value))
  if (deltas.length === 0) return 0
  return Math.max(...deltas)
}

export function evaluateLeagueScoreParityGate(input: LeagueScoreParityGateInput): LeagueScoreParityGateResult {
  const expectedMissingPlayerGameStatCount = Math.max(0, input.expectedMissingPlayerGameStatCount ?? 0)
  const expectedDuplicateInputCount = Math.max(0, input.expectedDuplicateInputCount ?? 0)
  const unexpectedGlobalFallbackCount = Math.max(0, input.unexpectedGlobalFallbackCount ?? 0)
  const scoringRulesHashMissingDocumented = Boolean(input.scoringRulesHashMissingDocumented)

  const failures: LeagueScoreParityGateFailure[] = []
  const summary = input.summary
  const teamDriftMaxAbs = summary.drift.maxTeamDriftAbs

  if (summary.drift.missingGameStats > expectedMissingPlayerGameStatCount) {
    failures.push({
      code: 'missing_player_game_stat_unexpected',
      message: `missing PlayerGameStat count ${summary.drift.missingGameStats} exceeds documented allowance ${expectedMissingPlayerGameStatCount}`,
    })
  }

  if (teamDriftMaxAbs > DRIFT_THRESHOLD) {
    failures.push({
      code: 'team_drift_above_threshold',
      message: `max team drift ${teamDriftMaxAbs.toFixed(2)} exceeds threshold ${DRIFT_THRESHOLD.toFixed(2)}`,
    })
  }

  if (summary.shadow.writeRequested && !summary.shadow.writeApplied) {
    failures.push({
      code: 'shadow_write_requested_but_not_applied',
      message: 'shadow write was requested but no write was applied',
    })
  }

  if (summary.shadow.duplicateInputCount > expectedDuplicateInputCount) {
    failures.push({
      code: 'duplicate_candidate_keys_unexpected',
      message: `duplicate candidate keys ${summary.shadow.duplicateInputCount} exceeds expected ${expectedDuplicateInputCount}`,
    })
  }

  if (summary.shadow.scoringRulesHashMissingCount > 0 && !scoringRulesHashMissingDocumented) {
    failures.push({
      code: 'scoring_rules_hash_missing_undocumented',
      message: `scoringRulesHash missing count ${summary.shadow.scoringRulesHashMissingCount} is not documented`,
    })
  }

  if (unexpectedGlobalFallbackCount > 0) {
    failures.push({
      code: 'unexpected_global_fallback',
      message: `${unexpectedGlobalFallbackCount} unexpected global fallback event(s) observed`,
    })
  }

  if (summary.drift.mismatchedTeams > 0) {
    failures.push({
      code: 'ui_score_regression_detected',
      message: `${summary.drift.mismatchedTeams} team-level mismatch(es) detected vs current UI score surfaces`,
    })
  }

  return {
    pass: failures.length === 0,
    thresholds: {
      teamDriftMaxAbs: DRIFT_THRESHOLD,
      expectedMissingPlayerGameStatCount,
      expectedDuplicateInputCount,
      unexpectedGlobalFallbackCount,
    },
    failures,
  }
}
