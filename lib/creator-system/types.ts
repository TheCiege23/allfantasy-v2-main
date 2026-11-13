/**
 * Creator League System (PROMPT 141) - shared types.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

import type { LeagueSport } from '@prisma/client'

export const CREATOR_LEAGUE_SPORTS: LeagueSport[] = [
  'NFL',
  'NHL',
  'NBA',
  'MLB',
  'NCAAF',
  'NCAAB',
  'SOCCER',
]

export type CreatorVisibility = 'public' | 'unlisted' | 'private'
export type CreatorLeagueType = 'FANTASY' | 'BRACKET'
type CreatorBadge = 'verified' | 'partner' | 'featured' | 'analyst'

export interface CreatorBranding {
  logoUrl?: string | null
  coverImageUrl?: string | null
  primaryColor?: string | null
  accentColor?: string | null
  backgroundColor?: string | null
  tagline?: string | null
  communityName?: string | null
  fontFamily?: string | null
  inviteHeadline?: string | null
  cardStyle?: string | null
}

export interface CreatorSocialHandles {
  twitter?: string | null
  youtube?: string | null
  twitch?: string | null
  instagram?: string | null
  tiktok?: string | null
  podcast?: string | null
}

export interface CreatorLeaguePreviewDto {
  id: string
  name: string
  sport: string
  inviteUrl: string
  leagueTier?: number | null
  canJoinByRanking?: boolean
  inviteOnlyByTier?: boolean
}

export interface CreatorProfileDto {
  id: string
  userId: string
  handle: string
  slug: string
  displayName: string | null
  creatorType: string | null
  bio: string | null
  communitySummary: string | null
  avatarUrl: string | null
  bannerUrl: string | null
  websiteUrl: string | null
  socialHandles: CreatorSocialHandles | null
  isVerified: boolean
  verificationBadge: string | null
  visibility: CreatorVisibility
  communityVisibility: CreatorVisibility
  branding: CreatorBranding | null
  followerCount?: number
  leagueCount?: number
  totalLeagueMembers?: number
  featuredRank?: number | null
  featuredScore?: number | null
  isFollowing?: boolean
  topSports?: string[]
  featuredLeague?: CreatorLeaguePreviewDto | null
  viewerTier?: number | null
  viewerTierName?: string | null
  hiddenLeagueCount?: number
  createdAt: string
  updatedAt: string
}

export interface CreatorLeagueDto {
  id: string
  creatorId: string
  type: CreatorLeagueType
  leagueId: string | null
  bracketLeagueId: string | null
  name: string
  slug: string
  description: string | null
  sport: string
  inviteCode: string
  inviteUrl: string
  shareUrl: string
  isPublic: boolean
  maxMembers: number
  memberCount: number
  fillRate: number
  joinDeadline: string | null
  coverImageUrl: string | null
  communitySummary: string | null
  latestRecapTitle: string | null
  latestRecapSummary: string | null
  latestCommentary: string | null
  creator?: CreatorProfileDto | null
  isMember?: boolean
  leagueTier?: number | null
  canJoinByRanking?: boolean
  inviteOnlyByTier?: boolean
  viewerTier?: number | null
  viewerTierName?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatorAnalyticsSummaryDto {
  profileViews: number
  followCount: number
  leagueJoins: number
  inviteShares: number
  leagueMembers: number
  publicLeagues: number
  conversionRate: number
  topShareChannel: string | null
  featuredRank: number | null
  period: string
}

export interface UpsertCreatorProfileInput {
  handle?: string | null
  displayName?: string | null
  creatorType?: string | null
  bio?: string | null
  communitySummary?: string | null
  avatarUrl?: string | null
  bannerUrl?: string | null
  websiteUrl?: string | null
  socialHandles?: CreatorSocialHandles | null
  visibility?: CreatorVisibility
  communityVisibility?: CreatorVisibility
  branding?: CreatorBranding | null
  verificationBadge?: CreatorBadge | null
  isVerified?: boolean
  featuredRank?: number | null
}

export interface UpsertCreatorLeagueInput {
  type?: CreatorLeagueType
  leagueId?: string | null
  bracketLeagueId?: string | null
  name: string
  slug?: string | null
  description?: string | null
  sport: string
  isPublic?: boolean
  maxMembers?: number
  joinDeadline?: string | null
  coverImageUrl?: string | null
  communitySummary?: string | null
  latestRecapTitle?: string | null
  latestRecapSummary?: string | null
  latestCommentary?: string | null
  regenerateInvite?: boolean
}
