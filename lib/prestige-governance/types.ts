/**
 * Prestige & Governance Integration — shared types for commissioner, reputation, Hall of Fame, and legacy.
 * Single source for unified manager/team summaries and AI context.
 */

/** Unified manager summary: trust + legacy + HoF context. */
export interface UnifiedManagerSummary {
  managerId: string
  leagueId: string
  sport: string
  /** From reputation engine. */
  reputation: {
    overallScore: number
    tier: string
    commissionerTrustScore: number
    reliabilityScore: number
    activityScore: number
    tradeFairnessScore: number
    sportsmanshipScore: number
    toxicityRiskScore: number
  } | null
  /** From legacy engine. */
  legacy: {
    overallLegacyScore: number
    championshipScore: number
    playoffScore: number
    consistencyScore: number
    rivalryScore: number
    dynastyScore: number
  } | null
  /** Hall of Fame induction count for this manager in this league. */
  hallOfFameEntryCount: number
  /** Top HoF entry title if any. */
  topHallOfFameTitle: string | null
}

/** Unified team/franchise summary (legacy + HoF). */
export interface UnifiedTeamSummary {
  entityId: string
  entityType: 'TEAM' | 'FRANCHISE'
  leagueId: string
  sport: string
  legacy: {
    overallLegacyScore: number
    championshipScore: number
    playoffScore: number
    consistencyScore: number
    rivalryScore: number
    dynastyScore: number
  } | null
  hallOfFameEntryCount: number
  topHallOfFameTitle: string | null
}

/** Commissioner-facing context: trust alerts and prestige snapshot. */
export interface CommissionerTrustContext {
  leagueId: string
  /** Manager IDs with low trust (e.g. tier Risky or Neutral). */
  lowTrustManagerIds: string[]
  /** Manager IDs with high commissioner trust (for recognition). */
  highCommissionerTrustManagerIds: string[]
  /** Count of managers with reputation records. */
  reputationCoverageCount: number
  /** Count of managers with legacy records. */
  legacyCoverageCount: number
  /** Count of Hall of Fame entries for this league. */
  hallOfFameEntryCount: number
}

/** Input for unified prestige query. */
export interface UnifiedPrestigeQueryInput {
  leagueId: string
  sport?: string | null
  managerIds?: string[] | null
  entityIds?: string[] | null
  entityType?: 'MANAGER' | 'TEAM' | 'FRANCHISE' | null
}

/** AI context payload for governance + trust + history + prestige. */
export interface AIPrestigeContextPayload {
  sport: string
  leagueId: string
  /** Short governance summary (commissioner trust, low-trust count). */
  governanceSummary: string
  /** Short reputation summary (tiers, coverage). */
  reputationSummary: string
  /** Short legacy summary (leaderboard hint). */
  legacySummary: string
  /** Short Hall of Fame summary (inductions, moments). */
  hallOfFameSummary: string
  /** Combined narrative hint for AI. */
  combinedHint: string
}
