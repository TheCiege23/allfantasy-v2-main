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

/** When a draft lands on the VIEWER's clock (lib/public-discovery/findLeagueFilters). */
export type DraftWhenFilter = "any" | "upcoming" | "next_7_days" | "weeknight" | "weekend"
/** US region of a league's official time zone. */
export type TimeZoneRegionFilter =
  | "any"
  | "eastern"
  | "central"
  | "mountain"
  | "pacific"
  | "alaska_hawaii"
  | "outside_us"
/** Where a league sits against the viewer's rank. */
export type RankBand = "step_up" | "your_level" | "chill"
export type RankBandFilter = "all" | RankBand

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
  /** The league's official IANA time zone, when it has one. */
  timezone?: string | null
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
  /** Step up / your level / chill against the signed-in viewer's rank; absent for anonymous viewers. */
  rankBand?: RankBand | null
  /** "invite": join here with the code. "request": the league plays elsewhere; ask the commissioner. */
  joinMode?: "invite" | "request"
  /** For a league that plays on another platform: which one (sleeper, espn, …). */
  externalPlatform?: string | null
  /** How the lister was shown to be the commissioner (lib/public-discovery/externalListing.ts). */
  listingVerification?: "provider" | "attestation" | null
  /** The commissioner's note on an external listing. */
  listingNote?: string | null
  /** Entry fee in dollars, when the league states one. AllFantasy never collects it. */
  entryFee?: number | null
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
  draftWhen?: DraftWhenFilter
  tzRegion?: TimeZoneRegionFilter
  rankBand?: RankBandFilter
  /** The viewer's IANA zone, so draft windows are judged on their clock. */
  viewerTimeZone?: string | null
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
  /** Set when paid leagues were withheld because of where the viewer is (lib/geo/paidLeagueGeo.ts). */
  paidLeaguesHidden?: { message: string } | null
}
