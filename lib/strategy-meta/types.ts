/**
 * Strategy Meta Analyzer — shared types.
 * Supports NFL, NHL, NBA, MLB, NCAAF, NCAAB, SOCCER.
 */

import { type SupportedSport } from '@/lib/sport-scope'

export type StrategySport = SupportedSport

/** Strategy types to detect (Chunk 2 will implement rules). */
const STRATEGY_TYPES = [
  'ZeroRB',
  'HeroRB',
  'EarlyQB',
  'LateQB',
  'EliteTE',
  'BalancedBuild',
  'StarsAndScrubsBuild',
  'DepthHeavyBuild',
  'GoaliePitcherHeavyBuild',
  'RookieHeavyBuild',
  'VeteranHeavyBuild',
  'StackingStrategies',
] as const
export type StrategyType = (typeof STRATEGY_TYPES)[number]

/** League format for segmenting meta (e.g. dynasty vs redraft, SF vs 1QB). */
export type LeagueFormat = 'dynasty_sf' | 'dynasty_1qb' | 'redraft_sf' | 'redraft_1qb' | 'unknown'

/** Single draft pick (Sleeper-style or normalized). */
export interface DraftPickFact {
  round: number
  pickNo: number
  rosterId: number
  playerId: string | null
  position: string | null
  team?: string | null
}

/** Position counts or value by position (sport-agnostic keys). */
export interface PositionDistribution {
  [position: string]: number
}

/** Per-team strategy detection result. */
export interface DetectedStrategy {
  strategyType: StrategyType
  confidence: number
  signals: string[]
}

/** Configurable round thresholds per sport (NFL-centric; others can override). */
export interface StrategyDetectionConfig {
  /** Rounds to check for "no RB" (ZeroRB). */
  zeroRbRounds: number
  /** Max RBs in first 2 rounds for HeroRB. */
  heroRbMaxRbInFirstTwo: number
  /** Round ceiling for "early QB" (e.g. 3 = QB in rounds 1-3). */
  earlyQbRoundCeiling: number
  /** Round floor for "late QB" (no QB before this round). */
  lateQbRoundFloor: number
  /** Round ceiling for "Elite TE". */
  eliteTeRoundCeiling: number
  /** RB position keys for this sport (e.g. ['RB'] for NFL). */
  rbPositions: string[]
  /** QB position keys. */
  qbPositions: string[]
  /** TE position keys (empty for non-NFL). */
  tePositions: string[]
}

/** Input for strategy detection (one team). */
export interface StrategyDetectionInput {
  sport: StrategySport
  leagueFormat: LeagueFormat
  draftPicks: DraftPickFact[]
  rosterPositions: PositionDistribution
  rosterValueByPosition?: PositionDistribution
  /** Optional: same-team pairs for stack detection (e.g. QB+WR). */
  stacks?: Array<{ type: string; players: string[] }>
  /** Optional: for RookieHeavyBuild / VeteranHeavyBuild. */
  rookieCount?: number
  veteranCount?: number
}

/** Report row for platform-wide strategy meta (Chunk 3). */
export interface StrategyMetaReportDto {
  strategyType: StrategyType
  sport: string
  usageRate: number
  successRate: number
  trendingDirection: 'Rising' | 'Stable' | 'Falling'
  leagueFormat: string
  sampleSize: number
  createdAt?: string
}
