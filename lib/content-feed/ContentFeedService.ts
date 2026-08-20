import { prisma } from "@/lib/prisma"
import { getUserInterests } from "./UserInterestModel"
import { rankFeedItems } from "./FeedRankingResolver"
import { DEFAULT_SPORT, normalizeToSupportedSport } from "@/lib/sport-scope"
import {
  fetchCreatorFeedItems,
  fetchBlogFeedItems,
  fetchTrendFeedItems,
  fetchBracketHighlightItems,
  fetchLeagueRecapItems,
  buildAiStoryAndRankingPlaceholders,
} from "./FeedAggregationService"
import type { ContentFeedItem, FeedMode, FeedItemType } from "./types"

const DEFAULT_LIMIT = 30
const MAX_ITEMS_PER_SOURCE = 15

export interface GetContentFeedOptions {
  tab?: FeedMode
  sport?: string | null
  contentType?: FeedItemType | null
  limit?: number
}

/**
 * Aggregates creator posts, blog previews, trend alerts, bracket/recap cards, AI insights,
 * and legacy sources into a single feed. Ranks by mode (following | for_you | trending) and user interests.
 */
export async function getContentFeed(
  userId: string | null,
  limitOrOptions: number | GetContentFeedOptions = DEFAULT_LIMIT
): Promise<ContentFeedItem[]> {
  const limit =
    typeof limitOrOptions === "number"
      ? limitOrOptions
      : Math.max(1, limitOrOptions.limit ?? DEFAULT_LIMIT)
  const tab: FeedMode =
    typeof limitOrOptions === "object" && limitOrOptions.tab
      ? limitOrOptions.tab
      : "for_you"
  const sportFilter =
    typeof limitOrOptions === "object" ? limitOrOptions.sport ?? null : null
  const contentTypeFilter =
    typeof limitOrOptions === "object" ? limitOrOptions.contentType ?? null : null

  const interests = userId
    ? await getUserInterests(userId)
    : { sports: [], leagueIds: [] }

  const leagueIds = interests.leagueIds ?? []

  const [
    creatorItems,
    blogItems,
    trendItems,
    bracketItems,
    recapItems,
    mediaArticles,
    sportsNews,
    legacyBracketEvents,
    aiPlaceholders,
  ] = await Promise.all([
    fetchCreatorFeedItems(sportFilter, MAX_ITEMS_PER_SOURCE),
    fetchBlogFeedItems(sportFilter, MAX_ITEMS_PER_SOURCE),
    fetchTrendFeedItems(sportFilter, MAX_ITEMS_PER_SOURCE),
    fetchBracketHighlightItems(leagueIds, MAX_ITEMS_PER_SOURCE),
    fetchLeagueRecapItems(leagueIds, MAX_ITEMS_PER_SOURCE),
    fetchMediaArticles(leagueIds),
    fetchSportsNews(interests.sports),
    fetchBracketFeedEvents(leagueIds),
    Promise.resolve(buildAiStoryAndRankingPlaceholders(sportFilter)),
  ])

  const aiInsights = buildAiInsightPlaceholders(userId)

  let combined: ContentFeedItem[] = [
    ...creatorItems,
    ...blogItems,
    ...trendItems,
    ...bracketItems,
    ...recapItems,
    ...mediaArticles,
    ...sportsNews,
    ...legacyBracketEvents,
    ...aiPlaceholders,
    ...aiInsights,
  ]

  combined = [...combined, ...buildDailyCoveragePlaceholders(combined, sportFilter)]

  if (contentTypeFilter) {
    combined = combined.filter((i) => i.type === contentTypeFilter)
  }

  const ranked = rankFeedItems(combined, interests, tab)
  return ranked.slice(0, Math.max(1, limit))
}

function buildDailyCoveragePlaceholders(
  existing: ContentFeedItem[],
  sportFilter: string | null
): ContentFeedItem[] {
  const existingTypes = new Set(existing.map((item) => item.type))
  const now = new Date().toISOString()
  const sport = normalizeToSupportedSport(sportFilter ?? DEFAULT_SPORT)
  const placeholders: ContentFeedItem[] = []

  if (!existingTypes.has("player_news")) {
    placeholders.push({
      id: "daily_player_news_placeholder",
      type: "player_news",
      title: `${sport} player news update`,
      body: "Daily injury and role updates are loading. Check back shortly for latest player news.",
      href: "/fantasy-media",
      sport,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    })
  }
  if (!existingTypes.has("league_update")) {
    placeholders.push({
      id: "daily_league_update_placeholder",
      type: "league_update",
      title: "League activity highlights",
      body: "No fresh league update cards yet. Open your league tabs to generate new activity highlights.",
      href: "/dashboard",
      sport: null,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    })
  }
  if (!existingTypes.has("community_highlight")) {
    placeholders.push({
      id: "daily_community_highlight_placeholder",
      type: "community_highlight",
      title: "Community highlights",
      body: "Bracket momentum and community highlights will appear here as events are published.",
      href: "/brackets",
      sport: null,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    })
  }
  if (!existingTypes.has("ai_insight")) {
    placeholders.push({
      id: "daily_ai_insight_placeholder",
      type: "ai_insight",
      title: "AI recommendation",
      body: "Ask Chimmy for a personalized edge on lineup, waiver, and trade decisions.",
      href: "/chimmy",
      sport: null,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    })
  }

  return placeholders
}

function fetchMediaArticles(leagueIds: string[]): Promise<ContentFeedItem[]> {
  if (leagueIds.length === 0) return Promise.resolve([])
  const leagueFilter =
    leagueIds.length > 0 ? { leagueId: { in: leagueIds } } : {}
  return (prisma as any).mediaArticle
    .findMany({
      where: leagueFilter,
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS_PER_SOURCE,
      select: {
        id: true,
        leagueId: true,
        sport: true,
        headline: true,
        body: true,
        createdAt: true,
      },
    })
    .then((rows: any[]) =>
      rows.map((r: any) => ({
        id: `media_${r.id}`,
        type: "league_update" as const,
        title: r.headline ?? "League update",
        body: (r.body ?? "").slice(0, 200),
        href: `/app/league/${r.leagueId}/news/${r.id}`,
        sport: r.sport ?? null,
        leagueId: r.leagueId ?? null,
        leagueName: null,
        createdAt: new Date(r.createdAt).toISOString(),
        sourceId: r.id,
        sourceType: "media_article" as const,
      }))
    )
    .catch(() => [])
}

function fetchSportsNews(sports: string[]): Promise<ContentFeedItem[]> {
  const sportFilter = sports.length > 0 ? { sport: { in: sports } } : {}
  return (prisma as any).sportsNews
    .findMany({
      where: sportFilter,
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS_PER_SOURCE,
      select: {
        id: true,
        sport: true,
        title: true,
        description: true,
        content: true,
        sourceUrl: true,
        playerName: true,
        createdAt: true,
      },
    })
    .then((rows: any[]) =>
      rows.map((r: any) => ({
        id: `news_${r.id}`,
        type: "player_news" as const,
        title: r.title ?? "Player news",
        body: (r.description || r.content || "").slice(0, 200),
        href: r.sourceUrl ?? "/dashboard",
        sport: r.sport ?? null,
        leagueId: null,
        leagueName: null,
        createdAt: new Date(r.createdAt).toISOString(),
        sourceId: r.id,
        sourceType: "sports_news" as const,
      }))
    )
    .catch(() => [])
}

function fetchBracketFeedEvents(leagueIds: string[]): Promise<ContentFeedItem[]> {
  const where: any = {}
  if (leagueIds.length > 0) {
    where.OR = [{ leagueId: { in: leagueIds } }, { leagueId: null }]
  } else {
    where.leagueId = null
  }
  return (prisma as any).bracketFeedEvent
    .findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_ITEMS_PER_SOURCE,
      select: {
        id: true,
        leagueId: true,
        tournamentId: true,
        eventType: true,
        headline: true,
        detail: true,
        createdAt: true,
      },
    })
    .then((rows: any[]) =>
      rows.map((r: any) => ({
        id: `bracket_${r.id}`,
        type: "community_highlight" as const,
        title: r.headline ?? "Bracket update",
        body: (r.detail ?? "").slice(0, 200),
        href: r.leagueId
          ? `/brackets/leagues/${r.leagueId}`
          : r.tournamentId
            ? `/brackets/tournament/${r.tournamentId}`
            : "/brackets",
        sport: null,
        leagueId: r.leagueId ?? null,
        leagueName: null,
        createdAt: new Date(r.createdAt).toISOString(),
        sourceId: r.id,
        sourceType: "bracket_feed" as const,
      }))
    )
    .catch(() => [])
}

function buildAiInsightPlaceholders(userId: string | null): ContentFeedItem[] {
  const now = new Date().toISOString()
  return [
    {
      id: "ai_trade_tip",
      type: "ai_insight",
      title: "AI trade tip",
      body: "Use the Trade Analyzer to compare offers and get fairness scores for your league.",
      href: "/legacy?tab=trade",
      sport: null,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    },
    {
      id: "ai_waiver_tip",
      type: "ai_insight",
      title: "Waiver AI",
      body: "Get suggested adds and drops based on your roster and league settings.",
      href: "/waiver-ai",
      sport: null,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    },
  ]
}
