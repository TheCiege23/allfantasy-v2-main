/**
 * BlogTopicPlanner — suggests topics and content types for the automated blog engine.
 * Sport-aware; uses sport-scope for supported sports.
 */

import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import type { BlogCategory } from "./types"
import { BLOG_CATEGORIES, BLOG_CATEGORY_LABELS } from "./types"

export interface TopicSuggestion {
  category: BlogCategory
  label: string
  topicHint: string
  sport?: string
}

const SPORT_LABELS: Record<string, string> = {
  NFL: "Fantasy Football",
  NHL: "Fantasy Hockey",
  NBA: "Fantasy Basketball",
  MLB: "Fantasy Baseball",
  NCAAB: "NCAA Basketball",
  NCAAF: "NCAA Football",
  SOCCER: "Fantasy Soccer",
}

/**
 * Returns default topic hints per category (sport-agnostic or sport-specific).
 */
export function getDefaultTopicHints(category: BlogCategory, sport?: string): string[] {
  const sportLabel = sport ? SPORT_LABELS[sport] ?? sport : "fantasy"
  const base: Record<BlogCategory, string[]> = {
    weekly_strategy: [
      `Week 7 ${sportLabel} lineup decisions`,
      `Midseason ${sportLabel} strategy`,
      `Bye week and lineup optimization`,
    ],
    waiver_wire: [
      `${sportLabel} waiver wire priorities`,
      `Top pickups for ${sportLabel} this week`,
      `Deep league ${sportLabel} targets`,
    ],
    trade_value: [
      `${sportLabel} trade value chart update`,
      `Buy low / sell high in ${sportLabel}`,
      `Dynasty ${sportLabel} trade targets`,
    ],
    draft_prep: [
      `${sportLabel} draft strategy 2024`,
      `Tiers and ADP for ${sportLabel}`,
      `${sportLabel} rookie impact`,
    ],
    matchup_preview: [
      `${sportLabel} key matchups this week`,
      `Playoff matchup preview ${sportLabel}`,
      `Must-win ${sportLabel} matchups`,
    ],
    bracket_strategy: [
      "March Madness bracket strategy",
      "Upset picks and chalk",
      "Bracket pool tips",
    ],
    playoff_recap: [
      `${sportLabel} playoff recap`,
      `Championship recap ${sportLabel}`,
      `Season in review ${sportLabel}`,
    ],
    ranking_updates: [
      `${sportLabel} rest-of-season rankings`,
      `Top 100 ${sportLabel} update`,
      `${sportLabel} position rankings`,
    ],
    sport_trends: [
      `2024 ${sportLabel} trends`,
      `Injury impact on ${sportLabel}`,
      `Scoring trends in ${sportLabel}`,
    ],
    creator_recap: [
      `Creator league highlights ${sportLabel}`,
      `Community recap ${sportLabel}`,
      `Top creator leagues this week`,
    ],
    player_trend_feature: [
      `${sportLabel} breakouts to watch`,
      `Usage trends ${sportLabel}`,
      `Slump and surge candidates ${sportLabel}`,
    ],
    ai_explainer: [
      "How to use Chimmy for fantasy trades",
      "Using the waiver advisor",
      "Mock draft with Chimmy",
    ],
    tool_landing: [
      "Trade Analyzer guide",
      "Waiver Wire Advisor tips",
      "Mock Draft Simulator walkthrough",
    ],
  }
  return base[category] ?? []
}

/**
 * List all supported sports for the blog (from sport-scope).
 */
export function getSupportedSports(): string[] {
  return [...SUPPORTED_SPORTS]
}

/**
 * List all categories with labels.
 */
export function getCategoriesWithLabels(): { value: BlogCategory; label: string }[] {
  return BLOG_CATEGORIES.map((c) => ({ value: c, label: BLOG_CATEGORY_LABELS[c] }))
}

/**
 * Suggest a set of topics for a given sport (for UI topic selector).
 */
export function suggestTopicsForSport(sport: string): TopicSuggestion[] {
  const out: TopicSuggestion[] = []
  for (const category of BLOG_CATEGORIES) {
    const hints = getDefaultTopicHints(category, sport)
    hints.forEach((hint) => {
      out.push({
        category,
        label: BLOG_CATEGORY_LABELS[category],
        topicHint: hint,
        sport,
      })
    })
  }
  return out.slice(0, 24)
}
