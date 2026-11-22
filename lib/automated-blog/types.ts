/**
 * Automated Blog Engine — shared types.
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer via sport-scope.
 */

import type { LeagueSport } from "@prisma/client"

export type PublishStatus = "draft" | "scheduled" | "published"

export const BLOG_CATEGORIES = [
  "weekly_strategy",
  "waiver_wire",
  "trade_value",
  "draft_prep",
  "matchup_preview",
  "bracket_strategy",
  "playoff_recap",
  "ranking_updates",
  "sport_trends",
  "creator_recap",
  "player_trend_feature",
  "ai_explainer",
  "tool_landing",
] as const

export type BlogCategory = (typeof BLOG_CATEGORIES)[number]

export const BLOG_CATEGORY_LABELS: Record<BlogCategory, string> = {
  weekly_strategy: "Weekly Strategy",
  waiver_wire: "Waiver Wire",
  trade_value: "Trade Value",
  draft_prep: "Draft Prep",
  matchup_preview: "Matchup Preview",
  bracket_strategy: "Bracket Strategy",
  playoff_recap: "Playoff Recap",
  ranking_updates: "Ranking Updates",
  sport_trends: "Sport Trends",
  creator_recap: "Creator Recap",
  player_trend_feature: "Player Trend Feature",
  ai_explainer: "Chimmy Explainer",
  tool_landing: "Tool Landing",
}

export interface BlogArticleRow {
  articleId: string
  title: string
  slug: string
  sport: string
  category: string
  excerpt: string | null
  body: string
  seoTitle: string | null
  seoDescription: string | null
  tags: string[]
  publishStatus: string
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface BlogDraftInput {
  sport: LeagueSport
  category: BlogCategory
  topicHint?: string
  contentType: keyof typeof CONTENT_TYPE_PROMPTS
}

export interface GeneratedDraft {
  title: string
  slug: string
  excerpt: string
  body: string
  seoTitle: string
  seoDescription: string
  tags: string[]
}

export interface InternalLinkSuggestion {
  anchor: string
  href: string
  reason?: string
}

/** Content type prompts for generation (sport/category-aware). */
export const CONTENT_TYPE_PROMPTS: Record<
  string,
  { system: string; userPrefix: string }
> = {
  weekly_strategy: {
    system:
      "You are an expert fantasy sports writer. Write a weekly strategy article. Output valid JSON with keys: title, slug (URL-safe, lowercase, hyphens), excerpt (1-2 sentences), body (markdown, 3-5 paragraphs), seoTitle (under 60 chars), seoDescription (under 160 chars), tags (array of 3-6 strings). Be specific to the sport and actionable.",
    userPrefix: "Write a weekly fantasy strategy article",
  },
  waiver_wire: {
    system:
      "You are a fantasy sports analyst. Write a waiver wire article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags. Focus on pickups and priorities.",
    userPrefix: "Write a waiver wire article",
  },
  trade_value: {
    system:
      "You are a fantasy trade analyst. Write a trade value article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags. Include value tiers or key names where relevant.",
    userPrefix: "Write a trade value article",
  },
  draft_prep: {
    system:
      "You are a fantasy draft expert. Write a draft prep article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags. Include strategy and tiers.",
    userPrefix: "Write a draft prep article",
  },
  matchup_preview: {
    system:
      "You are a fantasy analyst. Write a matchup preview article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags. Highlight key matchups.",
    userPrefix: "Write a matchup preview article",
  },
  bracket_strategy: {
    system:
      "You are an NCAA bracket analyst. Write a bracket strategy article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags.",
    userPrefix: "Write a bracket strategy article",
  },
  playoff_recap: {
    system:
      "You are a fantasy writer. Write a playoff recap article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags.",
    userPrefix: "Write a playoff recap article",
  },
  ranking_updates: {
    system:
      "You are a fantasy analyst. Write a ranking updates article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags. Include movement and rationale.",
    userPrefix: "Write a ranking updates article",
  },
  sport_trends: {
    system:
      "You are a fantasy trends analyst. Write a sport-specific trend article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags.",
    userPrefix: "Write a sport-specific trend article",
  },
  creator_recap: {
    system:
      "You are a fantasy content writer. Write a creator league or community recap article. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags. Highlight creator leagues and community moments.",
    userPrefix: "Write a creator recap article",
  },
  player_trend_feature: {
    system:
      "You are a fantasy analyst. Write a player trend feature article (breakouts, slumps, usage trends). Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags. Be stat-aware and actionable.",
    userPrefix: "Write a player trend feature article",
  },
  ai_explainer: {
    system:
      "You are an educator for fantasy sports tools. Write an AI explainer article that helps users understand how to use AI tools for fantasy. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags.",
    userPrefix: "Write a Chimmy explainer article for fantasy tools",
  },
  tool_landing: {
    system:
      "You are a content writer for a fantasy sports platform. Write a tool landing support article that explains a specific tool (trade analyzer, waiver advisor, mock draft, etc.) and its benefits. Output valid JSON with keys: title, slug, excerpt, body (markdown), seoTitle, seoDescription, tags.",
    userPrefix: "Write a tool landing support article",
  },
}
