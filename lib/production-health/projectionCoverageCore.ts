import type { ProjectionEvidence } from './projectionCoverageEvidence'

export type ChimmyProjection = {
  state: 'read' | 'ambiguous' | 'unrecognized'
  weekly: number | null
  fullSeason: number | null
}

export function parseChimmyProjection(answer: string, week: number | null): ChimmyProjection {
  const missing = { weekly: null, fullSeason: null }
  if (answer.includes('Several players match')) return { state: 'ambiguous', ...missing }
  if (answer.includes('AF has no matching projection')) return { state: 'read', ...missing }
  const weekly = week == null ? null : answer.match(new RegExp('\\bWeek ' + week + ': (-?\\d+\\.\\d{2}) fantasy points'))
  const season = answer.match(/(-?\d+\.\d{2}) fantasy points over the full season/)
  if (!season && !answer.includes('Full-season estimate unavailable')) return { state: 'unrecognized', ...missing }
  if (week != null && !weekly && !answer.includes('Weekly estimate unavailable')) return { state: 'unrecognized', ...missing }
  return { state: 'read', weekly: weekly ? Number(weekly[1]) : null, fullSeason: season ? Number(season[1]) : null }
}

type PlayerInput = {
  id: string
  name: string | null
  evidence?: ProjectionEvidence
  hasWeek: boolean
  lineupAvailable: boolean
  os?: { perGame: number; weekly: number | null; fullSeason: number | null; weekGames: number | null }
  lineup?: { points: number | null; unavailable: boolean }
  matchup: number | null
  chimmy?: ChimmyProjection
}

export function assessProjectionCoverage(input: PlayerInput) {
  const { id, name, evidence, os, lineup, matchup, chimmy, hasWeek, lineupAvailable } = input
  const weekly = os?.weekly ?? null
  const fullSeason = os?.fullSeason ?? null
  const mismatches: string[] = []
  if (hasWeek && lineupAvailable && (lineup?.points ?? null) !== (lineup?.unavailable ? 0 : weekly)) {
    mismatches.push('Roster and scoreboard weekly')
  }
  if (hasWeek && matchup !== weekly) mismatches.push('Matchup Center weekly')
  if (chimmy?.state === 'read') {
    if (hasWeek && chimmy.weekly !== weekly) mismatches.push('Chimmy weekly')
    if (chimmy.fullSeason !== fullSeason) mismatches.push('Chimmy full season')
  }

  let reason
  if (os) {
    reason = !hasWeek ? 'no_regular_week'
      : weekly == null ? 'weekly_schedule_missing'
        : os.weekGames === 0 ? 'no_game_this_week' : 'projected'
  } else if (evidence?.hasSnapshot) reason = 'stored_projection_missing_on_board'
  else if ((evidence?.games ?? 0) >= 2) reason = 'verified_stats_without_projection'
  else if (!evidence || evidence.identity === 'missing') reason = 'identity_missing'
  else if (evidence.identity === 'ambiguous') reason = 'identity_ambiguous'
  else if (evidence.identity === 'unsupported') reason = 'roster_id_space_unsupported'
  else if (evidence.hasPriorSnapshot) reason = 'prior_baseline_without_current_sample'
  else if (evidence.games === 1) reason = 'one_verified_game'
  else reason = 'no_verified_scoring_sample'

  return {
    id, name, reason, mismatches,
    evidenceGames: evidence?.games || null,
    needsProjectionReview: reason === 'verified_stats_without_projection' || reason === 'stored_projection_missing_on_board',
    points: { perGame: os?.perGame ?? null, weekly, fullSeason, lineup: lineup?.points ?? null, matchup },
    lineupUnavailable: lineup?.unavailable ?? false,
    chimmy: chimmy ?? null,
  }
}

export type CoveragePlayer = ReturnType<typeof assessProjectionCoverage>
