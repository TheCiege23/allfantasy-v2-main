/**
 * Fantasy News Aggregator — types (Prompt 118 + Prompt 131).
 */

export type FeedType = 'player' | 'team';

export interface NewsFeedItem {
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
  publishedAt: string | null;
  sport?: string;
}

// ——— Prompt 131: Enriched intelligence output ———

export type NewsType =
  | 'injury'
  | 'transaction'
  | 'performance'
  | 'roster'
  | 'coaching'
  | 'rumor'
  | 'official_release'
  | 'other';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface EnrichedNewsItem extends NewsFeedItem {
  headline: string;
  summary: string | null;
  fantasyImpact: string | null;
  confidenceLevel: ConfidenceLevel;
  importanceScore: number;
  newsType: NewsType | null;
  playersMentioned: string[];
}
