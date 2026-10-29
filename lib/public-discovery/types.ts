/**
 * Public League Discovery Engine (PROMPT 144) — types.
 * Safe public data only; supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { PublicReputation } from "@/lib/commish-reputation/reputation"

export type DiscoverySource = "fantasy" | "bracket" | "creator"

export type DiscoverySort = "ranking_match" | "popularity" | "newest" | "filling_fast"

export type DiscoveryFormat = "all" | "fantasy" | "bracket" | "creator"

export type EntryFeeFilter = "all" | "free" | "paid"
export type DiscoveryLeagueStyle =
  | "redraft"
  | "dynasty"
  | "best_ball"
  | "keeper"
  | "survivor"
  | "bracket"
  | "community"
export type LeagueStyleFilter = "all" | DiscoveryLeagueStyle

export type DraftTypeFilter = "all" | "snake" | "linear" | "auction"
export type DraftStatusFilter = "all" | "pre_draft" | "in_progress" | "paused" | "completed"
export type VisibilityFilter = "public" | "all"

export interface DiscoveryCard {
  source: DiscoverySource
  id: string
  name: string
  description: string | null
  sport: string
  memberCount: number
  maxMembers: number
  joinUrl: string
  detailUrl: string
  ownerName: string | null
  ownerAvatar: string | null
  creatorSlug: string | null
  creatorName: string | null
  tournamentName: string | null
  season: number | null
  scoringMode: string | null
  isPaid: boolean
  isPrivate: boolean
  createdAt: string
  fillPct: number
  /** League type for display (fantasy | bracket | creator). */
  leagueType: DiscoverySource
  /** League style for discovery filtering (dynasty, redraft, best_ball, etc.). */
  leagueStyle?: DiscoveryLeagueStyle | null
  /** Draft type when available (snake | linear | auction). */
  draftType: string | null
  /** Draft session status when available (pre_draft | in_progress | paused | completed). */
  draftStatus?: string | null
  /** Team/slot count (same as maxMembers). */
  teamCount: number
  /** Draft or join deadline when available (ISO). */
  draftDate: string | null
  /** Commissioner display name (same as ownerName). */
  commissionerName: string | null
  /** Commish reputation, only when the commissioner made it public for this league (lib/commish-reputation). */
  commissionerReputation?: PublicReputation | null
  /** AI-enabled features for display (e.g. ["ADP", "Trade"]). */
  aiFeatures: string[]
  /** Creator leagues only: FANTASY | BRACKET. */
  creatorLeagueType?: string | null
  /** Creator leagues only: whether creator has verified badge. */
  isCreatorVerified?: boolean
  /** Optional career tier for tier-gated league visibility. */
  leagueTier?: number | null
  /** True when league is outside viewer tier range and shown only for admin/owner contexts. */
  inviteOnlyByTier?: boolean
  /** Whether the current viewer can join directly without an invite override. */
  canJoinByRanking?: boolean
  /** Ranking-fit score used for discovery ordering (higher = better fit). */
  rankingEffectScore?: number
  /** Absolute tier distance between viewer and league tier. */
  rankingTierDelta?: number
}

export interface DiscoverLeaguesInput {
  query?: string | null
  sport?: string | null
  format?: DiscoveryFormat
  style?: LeagueStyleFilter
  sort?: DiscoverySort
  entryFee?: EntryFeeFilter
  page?: number
  limit?: number
  teamCountMin?: number | null
  teamCountMax?: number | null
  visibility?: VisibilityFilter
  draftType?: DraftTypeFilter
  draftStatus?: DraftStatusFilter
  aiEnabled?: boolean | null
}

export interface DiscoverLeaguesResult {
  leagues: DiscoveryCard[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasMore?: boolean
  viewerTier?: number
  viewerTierName?: string
  hiddenByTierPolicy?: number
}
