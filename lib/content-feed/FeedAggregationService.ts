/**
 * Feed aggregation layer (PROMPT 148): creator, blog, trend, rankings, recaps, bracket, matchup.
 * Safe public/private filtering; blends creator + AI + platform content.
 */

import { prisma } from "@/lib/prisma";
import { getTrendFeed } from "@/lib/player-trend/TrendDetectionService";
import { SUPPORTED_SPORTS } from "@/lib/sport-scope";
import type { ContentFeedItem } from "./types";

const MAX_PER_SOURCE = 12;

/** Public creator leagues as creator_post cards. */
export async function fetchCreatorFeedItems(
  sportFilter: string | null,
  limit: number = MAX_PER_SOURCE
): Promise<ContentFeedItem[]> {
  const where: { isPublic: true; creator?: { visibility: string } } = { isPublic: true };
  if (sportFilter && SUPPORTED_SPORTS.includes(sportFilter as any)) {
    (where as any).sport = sportFilter;
  }
  const leagues = await (prisma as any).creatorLeague
    .findMany({
      where: { ...where, creator: { visibility: "public" } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      include: {
        creator: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    })
    .catch(() => []);

  return leagues.map((l: any) => ({
    id: `creator_${l.id}`,
    type: "creator_post" as const,
    title: l.name ?? "Creator league",
    body: (l.description ?? "").slice(0, 160),
    href: `/creators/${l.creator?.handle ?? l.creatorId}`,
    sport: l.sport ?? null,
    leagueId: l.id,
    leagueName: l.name ?? null,
    imageUrl: l.creator?.avatarUrl ?? null,
    createdAt: l.updatedAt?.toISOString?.() ?? new Date().toISOString(),
    sourceId: l.id,
    sourceType: "creator_league" as const,
    creatorId: l.creatorId ?? null,
    creatorHandle: l.creator?.handle ?? null,
    creatorDisplayName: l.creator?.displayName ?? null,
    creatorAvatarUrl: l.creator?.avatarUrl ?? null,
  }));
}

/** Published blog articles as blog_preview. */
export async function fetchBlogFeedItems(
  sportFilter: string | null,
  limit: number = MAX_PER_SOURCE
): Promise<ContentFeedItem[]> {
  const where: { publishStatus: string } = { publishStatus: "published" };
  if (sportFilter && SUPPORTED_SPORTS.includes(sportFilter as any)) {
    (where as any).sport = sportFilter;
  }
  const articles = await prisma.blogArticle
    .findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: limit,
    })
    .catch(() => []);

  return articles.map((a) => ({
    id: `blog_${a.articleId}`,
    type: "blog_preview" as const,
    title: a.title,
    body: (a.excerpt ?? a.body ?? "").slice(0, 200),
    href: `/blog/${a.slug}`,
    sport: a.sport ?? null,
    leagueId: null,
    leagueName: null,
    createdAt: (a.publishedAt ?? a.updatedAt).toISOString(),
    sourceId: a.articleId,
    sourceType: "blog_article" as const,
  }));
}

/** Trend feed as trend_alert. */
export async function fetchTrendFeedItems(
  sportFilter: string | null,
  limit: number = MAX_PER_SOURCE
): Promise<ContentFeedItem[]> {
  const sport = sportFilter && SUPPORTED_SPORTS.includes(sportFilter as any) ? sportFilter : undefined;
  const items = await getTrendFeed({ sport, limit, limitPerType: Math.ceil(limit / 4) }).catch(() => []);
  const uniq = new Map<string, boolean>();
  return items.slice(0, limit).map((item: any, i: number) => {
    const key = `${item.playerId}_${item.sport}_${item.trendType}`;
    const id = uniq.has(key) ? `trend_${item.playerId}_${item.sport}_${i}` : `trend_${item.playerId}_${item.sport}`;
    uniq.set(key, true);
    const label =
      item.trendType === "hot_streak"
        ? "Hot streak"
        : item.trendType === "cold_streak"
          ? "Cold streak"
          : item.trendType === "breakout_candidate"
            ? "Breakout"
            : item.trendType === "sell_high_candidate"
              ? "Sell high"
              : "Trend";
    return {
      id,
      type: "trend_alert" as const,
      title: `${label}: ${item.displayName ?? item.playerId}`,
      body: `${item.sport ?? ""} · Trend score ${(item.signals?.trendScore ?? 0).toFixed(0)}`,
      href: `/app/trend-feed${item.sport ? `?sport=${item.sport}` : ""}`,
      sport: item.sport ?? null,
      leagueId: null,
      leagueName: null,
      createdAt: new Date().toISOString(),
      sourceId: item.playerId,
      sourceType: "trend_feed" as const,
    };
  });
}

/** Bracket feed events as bracket_highlight_card. */
export async function fetchBracketHighlightItems(
  leagueIds: string[],
  limit: number = MAX_PER_SOURCE
): Promise<ContentFeedItem[]> {
  const where: any = {};
  if (leagueIds.length > 0) where.OR = [{ leagueId: { in: leagueIds } }, { leagueId: null }];
  else where.leagueId = null;
  const rows = await (prisma as any).bracketFeedEvent
    .findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    })
    .catch(() => []);

  return rows.map((r: any) => ({
    id: `bracket_${r.id}`,
    type: "bracket_highlight_card" as const,
    title: r.headline ?? "Bracket update",
    body: (r.detail ?? "").slice(0, 200),
    href: r.leagueId ? `/brackets/leagues/${r.leagueId}` : r.tournamentId ? `/brackets/tournament/${r.tournamentId}` : "/brackets",
    sport: null,
    leagueId: r.leagueId ?? null,
    leagueName: null,
    createdAt: new Date(r.createdAt).toISOString(),
    sourceId: r.id,
    sourceType: "bracket_feed" as const,
  }));
}

/** League media/articles as league_recap_card. */
export async function fetchLeagueRecapItems(
  leagueIds: string[],
  limit: number = MAX_PER_SOURCE
): Promise<ContentFeedItem[]> {
  if (leagueIds.length === 0) return [];
  const where = leagueIds.length > 0 ? { leagueId: { in: leagueIds } } : {};
  const rows = await (prisma as any).mediaArticle
    ?.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    })
    .catch(() => []) ?? [];

  return rows.map((r: any) => ({
    id: `recap_${r.id}`,
    type: "league_recap_card" as const,
    title: r.headline ?? "League recap",
    body: (r.body ?? "").slice(0, 200),
    href: `/app/league/${r.leagueId}/news/${r.id}`,
    sport: r.sport ?? null,
    leagueId: r.leagueId ?? null,
    leagueName: null,
    createdAt: new Date(r.createdAt).toISOString(),
    sourceId: r.id,
    sourceType: "media_article" as const,
  }));
}

/** Placeholder AI story cards, power rankings, and matchup cards (for blending). */
export function buildAiStoryAndRankingPlaceholders(sportFilter: string | null): ContentFeedItem[] {
  const sport = sportFilter && SUPPORTED_SPORTS.includes(sportFilter as any) ? sportFilter : "NFL";
  const now = new Date().toISOString();
  return [
    {
      id: "ai_story_1",
      type: "ai_story_card" as const,
      title: "AI matchup insight",
      body: "Get AI-powered matchup analysis and start/sit advice for your league.",
      href: "/chimmy",
      sport,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    },
    {
      id: "power_rank_1",
      type: "power_rankings_card" as const,
      title: "Power rankings",
      body: "See rest-of-season power rankings and tier breakdowns.",
      href: "/power-rankings",
      sport,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    },
    {
      id: "matchup_1",
      type: "matchup_card" as const,
      title: "Matchup preview",
      body: "View weekly matchups and projections for your league.",
      href: "/dashboard",
      sport,
      leagueId: null,
      leagueName: null,
      createdAt: now,
      sourceType: "ai_generated",
    },
  ];
}
