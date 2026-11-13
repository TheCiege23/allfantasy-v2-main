/**
 * AllFantasy AI Intelligence System — shared contracts for league context, health, and snapshots.
 */

import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'

export type IntelligenceChipState = 'connected' | 'degraded' | 'unavailable'

/** Aggregated integration health (real signals — not env-only). */
export type IntelligencePlatformHealth = {
  database: IntelligenceChipState
  sportsData: IntelligenceChipState
  news: IntelligenceChipState
  aiEngine: IntelligenceChipState
  /** Configured + cached player pipeline indicates live sports enrichment path. */
  rollingInsights: IntelligenceChipState
  clearSports: IntelligenceChipState
  computedAt: string
}

export type LeagueSourceKind = 'native_af' | 'imported' | 'unknown'

export type ResolvedLeagueIntelligenceContext = {
  leagueId: string
  userId: string
  leagueName: string | null
  sport: string
  platform: string
  platformLeagueId: string | null
  sourceKind: LeagueSourceKind
  season: number
  leagueStatus: string | null
  leagueTimezone: string | null
  membershipValidated: true
  /** `LeagueTeam.id` for the signed-in user when claimed */
  userTeamId: string | null
  userTeamExternalId: string | null
  userTeamName: string | null
  scoringSettings: { raw: string | null }
  rosterSettings: {
    rosterSize: number | null
    starters: unknown
    irSlots: number | null
    taxiSlots: number | null
  }
  leagueRules: {
    leagueType: string | null
    isDynasty: boolean
    waiverType: string | null
    waiverBudget: number | null
    tradeReviewHours: number | null
  }
  importedMappingInfo: {
    importedAt: string | null
    syncStatus: string | null
    lastSyncedAt: string | null
  } | null
  /** Full League Context Engine payload — authoritative for AI tools. */
  normalizedLeagueContext: NormalizedLeagueContext
}

