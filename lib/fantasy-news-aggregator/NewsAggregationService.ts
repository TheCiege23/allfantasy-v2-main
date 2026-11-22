/**
 * Aggregates fantasy-relevant news: player feed and team feed (Prompt 118 + 131).
 * Uses SportsNews from DB; optionally triggers sync when stale.
 * Supports all SUPPORTED_SPORTS (Prompt 131).
 */

import { prisma } from '@/lib/prisma';
import { normalizeTeamAbbrev } from '@/lib/team-abbrev';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import type { NewsFeedItem, FeedType } from './types';

const DEFAULT_LIMIT = 40;

export async function getPlayerNewsFeed(
  playerQuery: string,
  limit: number = DEFAULT_LIMIT,
  options?: { refresh?: boolean; sport?: string }
): Promise<NewsFeedItem[]> {
  const name = playerQuery.trim();
  if (!name) return [];

  const sport = options?.sport ? normalizeToSupportedSport(options.sport) : 'NFL';

  if (options?.refresh) {
    const { syncNewsToDb } = await import('@/app/api/sports/news/sync-helper');
    await syncNewsToDb(undefined);
  }

  const where = {
    sport,
    OR: [
      { playerName: { contains: name, mode: 'insensitive' as const } },
      { playerNames: { has: name } },
      { title: { contains: name, mode: 'insensitive' as const } },
      { description: { contains: name, mode: 'insensitive' as const } },
    ],
  };

  const rows = await prisma.sportsNews.findMany({
    where,
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });

  return rows.map((r) => rowToFeedItem(r, sport));
}

export async function getTeamNewsFeed(
  teamQuery: string,
  limit: number = DEFAULT_LIMIT,
  options?: { refresh?: boolean; sport?: string }
): Promise<NewsFeedItem[]> {
  const raw = teamQuery.trim();
  if (!raw) return [];

  const sport = options?.sport ? normalizeToSupportedSport(options.sport) : 'NFL';
  const team = normalizeTeamAbbrev(raw) || raw.toUpperCase();

  if (options?.refresh) {
    const { syncNewsToDb } = await import('@/app/api/sports/news/sync-helper');
    await syncNewsToDb(team);
  }

  const where = {
    sport,
    OR: [
      { team },
      { teams: { has: team } },
    ],
  };

  const rows = await prisma.sportsNews.findMany({
    where,
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });

  return rows.map((r) => rowToFeedItem(r, sport));
}

/** Fetch general news feed by sport (Prompt 131). */
export async function getNewsFeedBySport(
  sport: string,
  limit: number = DEFAULT_LIMIT,
  options?: { refresh?: boolean }
): Promise<NewsFeedItem[]> {
  const normalized = normalizeToSupportedSport(sport);
  if (options?.refresh) {
    const { syncNewsToDb } = await import('@/app/api/sports/news/sync-helper');
    await syncNewsToDb(undefined);
  }
  const rows = await prisma.sportsNews.findMany({
    where: { sport: normalized },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => rowToFeedItem(r, normalized));
}

export async function getAggregatedFeed(
  type: FeedType,
  query: string,
  limit: number = DEFAULT_LIMIT,
  options?: { refresh?: boolean; sport?: string }
): Promise<NewsFeedItem[]> {
  if (type === 'player') return getPlayerNewsFeed(query, limit, options);
  return getTeamNewsFeed(query, limit, options);
}

function rowToFeedItem(
  row: {
    id: string;
    title: string;
    description: string | null;
    source: string;
    sourceUrl: string | null;
    author: string | null;
    imageUrl: string | null;
    team: string | null;
    teams: string[];
    playerName: string | null;
    playerNames: string[];
    category: string | null;
    sentiment: string | null;
    publishedAt: Date | null;
  },
  sport?: string
): NewsFeedItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    source: row.source,
    sourceUrl: row.sourceUrl ?? null,
    author: row.author ?? null,
    imageUrl: row.imageUrl ?? null,
    team: row.team ?? null,
    teams: row.teams ?? [],
    playerName: row.playerName ?? null,
    playerNames: row.playerNames ?? [],
    category: row.category ?? null,
    sentiment: row.sentiment ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    sport,
  };
}
