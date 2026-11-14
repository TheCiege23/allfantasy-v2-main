/**
 * User Recommendation Engine (PROMPT 301) — types.
 * Recommendations for leagues, players, and strategies based on user behavior and preferences.
 */

import type { RecommendedLeagueWithExplanation } from "@/lib/league-recommendations/types"
import type { TrendingPlayer } from "@/lib/trending/types"
import type { AdviceType, StrategyRecommendation } from "@/lib/fantasy-coach/types"

/** Inferred tool usage from engagement events (counts over lookback window). */
export interface UserToolUsage {
  tradeAnalyzer: number
  waiverAi: number
  mockDraft: number
  chimmyChat: number
  lineupEdit: number
  leagueView: number
}

/** Extended user profile for recommendations: league preferences + behavior. */
export interface UserRecommendationProfile {
  /** Sports the user has leagues in (desc by count). */
  preferredSports: string[]
  /** Team counts from user's leagues. */
  preferredTeamCounts: number[]
  /** Primary sport for player/strategy context (first preferred or default). */
  primarySport: string
  /** Engagement-based tool usage counts. */
  toolUsage: UserToolUsage
  /** Last activity timestamp. */
  lastActiveAt: Date | null
  /** Optional context from user's first/active league for strategy recommendations. */
  leagueContext?: {
    leagueId: string
    leagueName: string
    sport?: string
    week?: number
  }
}

/** League recommendation (wraps existing league-recommendation type). */
export type RecommendedLeague = RecommendedLeagueWithExplanation

/** Player recommendation: trending player with optional reason. */
export interface RecommendedPlayer {
  player: TrendingPlayer
  /** Short reason (e.g. "Hot on waivers", "Rising in your sport"). */
  reason: string | null
}

/** Strategy recommendation (wraps fantasy-coach StrategyRecommendation). */
export interface RecommendedStrategy {
  type: AdviceType
  recommendation: StrategyRecommendation
  /** Why we're surfacing this (e.g. "You use trade tools often"). */
  reason: string | null
}

/** Full recommendation payload for a user. */
export interface UserRecommendations {
  leagues: RecommendedLeague[]
  players: RecommendedPlayer[]
  strategies: RecommendedStrategy[]
  /** Profile used to generate recommendations (optional, for debugging). */
  _profile?: Partial<UserRecommendationProfile>
}

