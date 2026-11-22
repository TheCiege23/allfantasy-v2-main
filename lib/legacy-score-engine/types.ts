/**
 * Legacy Score Engine — types for entity types, evidence, and scores.
 * Supports NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, Soccer.
 */

const LEGACY_ENTITY_TYPES = ['MANAGER', 'TEAM', 'FRANCHISE'] as const
export type LegacyEntityType = (typeof LEGACY_ENTITY_TYPES)[number]

/** Evidence types that feed legacy dimensions. */
const LEGACY_EVIDENCE_TYPES = [
  'championships',
  'playoff_appearances',
  'finals_appearances',
  'win_pct',
  'rivalry_dominance',
  'awards',
  'consistency',
  'dynasty_run',
  'high_difficulty_success',
  'staying_power',
] as const
export type LegacyEvidenceType = (typeof LEGACY_EVIDENCE_TYPES)[number]

export interface LegacyScores {
  overallLegacyScore: number
  championshipScore: number
  playoffScore: number
  consistencyScore: number
  rivalryScore: number
  awardsScore: number
  dynastyScore: number
}

export interface LegacyScoreEngineInput {
  entityType: LegacyEntityType
  entityId: string
  sport: string
  leagueId?: string | null
  replace?: boolean
}

export interface LegacyScoreEngineResult {
  legacyScoreId: string
  entityType: string
  entityId: string
  sport: string
  leagueId: string | null
  scores: LegacyScores
}

export interface LegacyQueryFilters {
  sport?: string | null
  leagueId?: string | null
  entityType?: LegacyEntityType | string | null
  limit?: number
  offset?: number
}
