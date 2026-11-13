/**
 * User Recommendation Engine (PROMPT 301).
 * Recommends leagues, players, and strategies from user behavior and preferences.
 */

import { prisma } from "@/lib/prisma"
import { DEFAULT_SPORT } from "@/lib/sport-scope"
import { getActivitySummary } from "@/lib/engagement-engine/UserActivityTracker"
import {
  getUserLeagueProfile,
  getPersonalizedRecommendations,
} from "@/lib/league-recommendations"
import { getTrendingPlayers } from "@/lib/trending"
import { getStrategyRecommendation } from "@/lib/fantasy-coach/StrategyRecommendationEngine"
import type { CoachContext } from "@/lib/fantasy-coach/types"
import type {
  UserRecommendationProfile,
  UserToolUsage,
  RecommendedLeague,
  RecommendedPlayer,
  RecommendedStrategy,
  UserRecommendations,
} from "./types"

const DEFAULT_LOOKBACK_DAYS = 30
const DEFAULT_LEAGUE_LIMIT = 6
const DEFAULT_PLAYER_LIMIT = 10
const DEFAULT_STRATEGY_TYPES = ["lineup", "trade", "waiver"] as const

/** Build tool-usage counts from engagement events (raw count by eventType). */
async function getToolUsage(userId: string, since: Date): Promise<UserToolUsage> {
  const events = await (prisma as any).engagementEvent
    .findMany({
      where: { userId, createdAt: { gte: since } },
      select: { eventType: true },
    })
    .catch(() => [])

  const usage: UserToolUsage = {
    tradeAnalyzer: 0,
    waiverAi: 0,
    mockDraft: 0,
    chimmyChat: 0,
    lineupEdit: 0,
    leagueView: 0,
  }

  for (const e of events) {
    switch (e.eventType) {
      case "trade_analyzer":
        usage.tradeAnalyzer++
        break
      case "waiver_ai":
        usage.waiverAi++
        break
      case "mock_draft":
        usage.mockDraft++
        break
      case "chimmy_chat":
        usage.chimmyChat++
        break
      case "lineup_edit":
        usage.lineupEdit++
        break
      case "league_view":
        usage.leagueView++
        break
      default:
        break
    }
  }

  return usage
}

/** Get optional league context (first user league) for strategy recommendations. */
async function getLeagueContext(userId: string): Promise<
  | {
      leagueId: string
      leagueName: string
      sport?: string
      week?: number
    }
  | undefined
> {
  const league = await prisma.league.findFirst({
    where: { userId },
    select: { id: true, name: true, sport: true },
    orderBy: { updatedAt: "desc" },
  })
  if (!league) return undefined
  return {
    leagueId: league.id,
    leagueName: league.name ?? "Your league",
    sport: league.sport ?? undefined,
    week: undefined,
  }
}

/**
 * Build user recommendation profile from leagues + engagement behavior.
 */
async function getUserRecommendationProfile(
  userId: string
): Promise<UserRecommendationProfile> {
  const since = new Date()
  since.setDate(since.getDate() - DEFAULT_LOOKBACK_DAYS)

  const [leagueProfile, activity, toolUsage, leagueContext] = await Promise.all([
    getUserLeagueProfile(userId),
    getActivitySummary(userId, since),
    getToolUsage(userId, since),
    getLeagueContext(userId),
  ])

  const primarySport =
    leagueProfile.preferredSports[0] ?? DEFAULT_SPORT

  return {
    preferredSports: leagueProfile.preferredSports,
    preferredTeamCounts: leagueProfile.preferredTeamCounts,
    primarySport,
    toolUsage,
    lastActiveAt: activity.lastActiveAt,
    leagueContext,
  }
}

/**
 * Get league recommendations for the user (personalized by sport and preferences).
 */
async function getLeagueRecommendations(
  userId: string,
  options: { limit?: number; sport?: string | null } = {}
): Promise<RecommendedLeague[]> {
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://allfantasy.ai"
  return getPersonalizedRecommendations(userId, baseUrl, {
    limit: options.limit ?? DEFAULT_LEAGUE_LIMIT,
    sport: options.sport ?? null,
  })
}

/**
 * Get player recommendations (trending players in the user's primary sport).
 */
async function getPlayerRecommendations(
  userId: string,
  options: { limit?: number; sport?: string | null; profile?: UserRecommendationProfile } = {}
): Promise<RecommendedPlayer[]> {
  const profile = options.profile ?? (await getUserRecommendationProfile(userId))
  const limit = Math.min(50, Math.max(1, options.limit ?? DEFAULT_PLAYER_LIMIT))
  const sport = (options.sport ?? profile.primarySport ?? "nfl").toLowerCase()

  const trending = await getTrendingPlayers({ sport, limit })

  return trending.map((player) => ({
    player,
    reason: player.crowdSignal
      ? `Trending ${player.crowdSignal.toLowerCase()} in ${sport.toUpperCase()}`
      : "Popular in your sport",
  }))
}

/**
 * Get strategy recommendations (lineup, trade, waiver) with optional ordering by tool usage.
 */
async function getStrategyRecommendations(
  userId: string,
  options: { profile?: UserRecommendationProfile } = {}
): Promise<RecommendedStrategy[]> {
  const profile = options.profile ?? (await getUserRecommendationProfile(userId))
  const ctx: CoachContext = {
    leagueId: profile.leagueContext?.leagueId,
    leagueName: profile.leagueContext?.leagueName,
    sport: profile.leagueContext?.sport ?? profile.primarySport,
    week: profile.leagueContext?.week,
  }

  const results: RecommendedStrategy[] = []

  for (const type of DEFAULT_STRATEGY_TYPES) {
    const rec = await getStrategyRecommendation(type, ctx)
    let reason: string | null = null
    if (type === "trade" && profile.toolUsage.tradeAnalyzer > 0) {
      reason = "You use trade tools often"
    } else if (type === "waiver" && profile.toolUsage.waiverAi > 0) {
      reason = "You use waiver tools often"
    } else if (type === "lineup" && profile.toolUsage.lineupEdit > 0) {
      reason = "You set lineups often"
    }
    results.push({ type, recommendation: rec, reason })
  }

  return results
}

interface GetRecommendationsOptions {
  leagueLimit?: number
  playerLimit?: number
  sport?: string | null
  includeProfile?: boolean
}

/**
 * Get full recommendations for a user: leagues, players, and strategies.
 */
export async function getRecommendations(
  userId: string,
  options: GetRecommendationsOptions = {}
): Promise<UserRecommendations> {
  const {
    leagueLimit = DEFAULT_LEAGUE_LIMIT,
    playerLimit = DEFAULT_PLAYER_LIMIT,
    sport = null,
    includeProfile = false,
  } = options

  const profile = await getUserRecommendationProfile(userId)
  const [leagues, players, strategies] = await Promise.all([
    getLeagueRecommendations(userId, { limit: leagueLimit, sport }),
    getPlayerRecommendations(userId, { limit: playerLimit, sport, profile }),
    getStrategyRecommendations(userId, { profile }),
  ])

  const out: UserRecommendations = {
    leagues,
    players,
    strategies,
  }

  if (includeProfile) {
    out._profile = profile
  }

  return out
}
