/**
 * Hall of Fame System — types for entries, moments, entity types, and categories.
 * Supports NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, Soccer.
 */

import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

export const HOF_SPORTS = [...SUPPORTED_SPORTS] as const

const HOF_ENTITY_TYPES = [
  'MANAGER',
  'TEAM',
  'MOMENT',
  'DYNASTY_RUN',
  'CHAMPIONSHIP_RUN',
  'RECORD_SEASON',
] as const
export type HallOfFameEntityType = (typeof HOF_ENTITY_TYPES)[number]

const HOF_CATEGORIES = [
  'all_time_great_managers',
  'all_time_great_teams',
  'greatest_moments',
  'biggest_upsets',
  'best_championship_runs',
  'longest_dynasties',
  'historic_comebacks',
  'iconic_rivalries',
] as const
export type HallOfFameCategory = (typeof HOF_CATEGORIES)[number]

export interface HallOfFameEntryInput {
  entityType: HallOfFameEntityType
  entityId: string
  sport: string
  leagueId?: string | null
  season?: string | null
  category: HallOfFameCategory
  title: string
  summary?: string | null
  score: number
  metadata?: Record<string, unknown> | null
}

export interface HallOfFameMomentInput {
  leagueId: string
  sport: string
  season: string
  headline: string
  summary?: string | null
  relatedManagerIds?: string[]
  relatedTeamIds?: string[]
  relatedMatchupId?: string | null
  significanceScore: number
}

export interface HallOfFameQueryFilters {
  sport?: string | null
  leagueId?: string | null
  season?: string | null
  category?: HallOfFameCategory | string | null
  entityType?: HallOfFameEntityType | string | null
  entityId?: string | null
  limit?: number
  offset?: number
}

export interface HallOfFameMomentQueryFilters {
  leagueId?: string | null
  sport?: string | null
  season?: string | null
  limit?: number
  offset?: number
}
