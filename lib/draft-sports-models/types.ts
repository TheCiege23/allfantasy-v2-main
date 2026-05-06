/**
 * Normalized internal models for draft ecosystem (live, mock, auction, slow, keeper, devy, C2C).
 * Sport-aware; do not assume one sport.
 * Supported: NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { LeagueSport } from '@prisma/client'
import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'

export type ProjectionSourceTag =
  | 'rolling_insights'
  | 'adp_position_fallback'
  | 'kicker_adp_binned_fallback'
  | 'rookie_adp_position_fallback'
  | 'team_def_baseline_fallback'

export type DraftSport = LeagueSport

/** Team display for logos and abbreviations (normalized from any provider). */
export interface TeamDisplayModel {
  teamId: string
  abbreviation: string
  displayName: string
  sport: DraftSport
  logoUrl: string | null
  /** Fallback used when logoUrl failed or missing */
  logoFallbackUsed?: boolean
}

/** Player assets (images) with fallbacks. */
export interface PlayerAssetModel {
  headshotUrl: string | null
  teamLogoUrl: string | null
  /** Optional explicit fallback URL when headshotUrl is missing. */
  headshotFallbackUrl?: string | null
  /** Optional explicit fallback URL when teamLogoUrl is missing. */
  teamLogoFallbackUrl?: string | null
  /** True when headshot is fallback (initial, placeholder) */
  headshotFallbackUsed?: boolean
  /** True when team logo is fallback */
  teamLogoFallbackUsed?: boolean
}

/** Key stat summary for draft panels (sport-appropriate). */
export interface PlayerStatSnapshotModel {
  /** e.g. "ADP 12" or "PPG 22.1" */
  primaryStatLabel?: string | null
  primaryStatValue?: number | null
  /** Optional secondary (e.g. "Bye 7") */
  secondaryStatLabel?: string | null
  secondaryStatValue?: number | null
  /** Raw for tooltips/sort */
  adp?: number | null
  byeWeek?: number | null
  /** Prior-season or blended PPG from analytics when attached to pool rows */
  fantasyPointsPerGame?: number | null
  lifetimeValue?: number | null
  /** Rolling Insights numbers when RI did not replace snapshot PPG (supplemental only). */
  rollingInsightsSupplemental?: {
    fantasyPointsPerGame?: number | null
    gamesPlayed?: number | null
    season?: string | null
  } | null
  /** Identifies how fantasyPointsPerGame was produced. */
  projectionSource?: ProjectionSourceTag | null
}

/** NFL pool row: where `yearsExp` attached during pool resolution came from (diagnostics). */
export type NflRookieYearsExpProvenance =
  | 'explicit_imported'
  | 'sleeper_live'
  | 'sleeper_db_cache'
  | 'analytics_veteran_inferred'

/** Draft-specific metadata (eligibility, injury, devy/C2C). */
export interface PlayerDraftMetadataModel {
  position: string
  /** Secondary positions if applicable (e.g. WR/TE) */
  secondaryPositions?: string[]
  /** Position eligibility tokens for roster-slot matching and filters. */
  positionEligibility?: string[]
  teamAbbreviation: string | null
  /** Team affiliation label (e.g. "KC", "Ohio State"). */
  teamAffiliation?: string | null
  byeWeek: number | null
  injuryStatus: string | null
  /** College or pipeline marker for devy/C2C */
  collegeOrPipeline?: string | null
  /** Eligibility note (e.g. "Rookie") */
  eligibilityNote?: string | null
  /** When known from SportsPlayer / pool row (NFL tab header chips). */
  age?: number | null
  classYearLabel?: string | null
  draftGrade?: string | null
  projectedLandingSpot?: string | null
  sport: DraftSport
  /** NFL: provenance for `yearsExp` when present (never inferred from undocumented RI fields). */
  rookieYearsExpSource?: NflRookieYearsExpProvenance | null
}

/** Full normalized player for draft UIs (live, mock, auction, slow, keeper, devy, C2C). */
export interface PlayerDisplayModel {
  playerId: string
  displayName: string
  sport: DraftSport
  assets: PlayerAssetModel
  team: TeamDisplayModel | null
  stats: PlayerStatSnapshotModel
  metadata: PlayerDraftMetadataModel
}

/** Normalized draft pool entry: display model + draft-specific fields (ADP, etc.). */
export interface NormalizedDraftEntry {
  display: PlayerDisplayModel
  /** For compatibility with existing PlayerEntry-style consumers */
  name: string
  position: string
  team: string | null
  adp?: number | null
  byeWeek?: number | null
  playerId?: string | null
  /** AI ADP when available */
  aiAdp?: number | null
  aiAdpSampleSize?: number
  aiAdpLowSample?: boolean
  injuryStatus?: string | null
  collegeOrPipeline?: string | null
  /** Devy: true when player is from devy/college pool */
  isDevy?: boolean
  /** Devy: school (e.g. "Ohio State") */
  school?: string | null
  classYearLabel?: string | null
  draftGrade?: string | null
  projectedLandingSpot?: string | null
  /** Devy: draft-eligible year */
  draftEligibleYear?: number | null
  /** Devy: true when player has graduated to NFL (promotion pipeline) */
  graduatedToNFL?: boolean
  /** C2C: explicit pool for Campus-to-Canton (college vs pro) */
  poolType?: 'college' | 'pro'
  /** NFL: season projections + splits for draft grid (optional). */
  nflDraftProjectionSplits?: NflDraftProjectionSplits | null
  /** D.7 — NFL years of pro experience (from Sleeper). 0 = rookie. null/undefined when unknown. */
  yearsExp?: number | null
  /** D.7 — convenience flag derived during normalization (yearsExp === 0 || explicit upstream rookie marker). */
  isRookie?: boolean
  /** Identifies how fantasyPointsPerGame was produced. */
  projectionSource?: ProjectionSourceTag | null
  /** Block B.2-C — rookie inference inputs surfaced from the resolver so the
   * client predicate can branch per sport without reaching into display.metadata.
   * All optional / string|number tolerant — upstream sources may use either shape. */
  age?: number | string | null
  draftYear?: number | string | null
  rookieYear?: number | string | null
  debutYear?: number | string | null
  firstSeasonYear?: number | string | null
  classYear?: string | null
}
