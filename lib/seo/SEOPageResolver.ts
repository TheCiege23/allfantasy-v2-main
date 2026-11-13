/**
 * Resolves SEO page config by path or page key.
 * Integrates with seo-landing config for tools and sports; defines metadata for other key routes.
 */

import { getPublicSiteOrigin } from "@/lib/site-public-origin"

const BASE = getPublicSiteOrigin()

type PageKey =
  | "home"
  | "tools-hub"
  | "trade-analyzer"
  | "trade-evaluator"
  | "waiver-ai"
  | "mock-draft"
  | "brackets"
  | "bracket-challenge"
  | "leagues"
  | "chimmy"
  | "sport"
  | "tool"

export interface SEOPageConfig {
  title: string
  description: string
  canonical: string
  keywords?: string[]
  imagePath?: string
  noIndex?: boolean
}

const STATIC_PAGES: Record<string, SEOPageConfig> = {
  home: {
    title: "AllFantasy – AI Powered Fantasy Sports Tools",
    description:
      "AllFantasy combines fantasy sports leagues, bracket challenges, and AI-powered tools to help players draft smarter, analyze trades, and dominate their leagues.",
    canonical: BASE + "/",
    keywords: ["fantasy sports", "fantasy football tools", "fantasy trade analyzer", "AI fantasy sports", "fantasy bracket challenge"],
  },
  "tools-hub": {
    title: "Fantasy Tools Hub – All Tools & Sports | AllFantasy",
    description:
      "Discover AllFantasy tools: trade analyzer, mock draft, waiver advisor, bracket challenge, power rankings, and AI fantasy assistant. Browse by sport and tool.",
    canonical: BASE + "/tools-hub",
    keywords: ["fantasy tools", "trade analyzer", "mock draft", "waiver wire", "bracket challenge"],
  },
  "trade-analyzer": {
    title: "Fantasy Trade Analyzer – AI-Powered Trade Grades | AllFantasy",
    description:
      "AllFantasy trade analyzer evaluates fantasy football, basketball, baseball, and more with AI grades, context-aware analysis, and counter-offer suggestions.",
    canonical: BASE + "/trade-analyzer",
    keywords: ["fantasy trade analyzer", "trade analyzer", "fantasy football trade", "AI trade analysis"],
  },
  "trade-evaluator": {
    title: "Trade Evaluator – Analyze Deals in Context | AllFantasy",
    description:
      "Evaluate fantasy trades with league context. Get grades, lineup impact, and AI explanations for both sides.",
    canonical: BASE + "/trade-evaluator",
    keywords: ["trade evaluator", "fantasy trade", "trade grades"],
  },
  "waiver-ai": {
    title: "Waiver Wire Advisor – AI Pickup & Lineup Help | AllFantasy",
    description:
      "AllFantasy waiver wire advisor gives AI-powered pickup recommendations and lineup help tuned to your league settings and scoring.",
    canonical: BASE + "/waiver-ai",
    keywords: ["waiver wire advisor", "fantasy waiver", "pickup recommendations", "lineup help"],
  },
  "mock-draft": {
    title: "Mock Drafts – Fantasy Football & More | AllFantasy",
    description:
      "Create, run, and share unlimited AllFantasy mock drafts with AI-powered insights. Snake and auction, multiple sports.",
    canonical: BASE + "/mock-draft",
    keywords: ["mock draft simulator", "fantasy mock draft", "draft simulator", "AI draft"],
  },
  brackets: {
    title: "NCAA Bracket Challenge – Pools & AI Analysis | AllFantasy",
    description:
      "AllFantasy NCAA bracket challenge: create pools, invite friends, fill out brackets, and use AI to stress-test your picks.",
    canonical: BASE + "/brackets",
    keywords: ["bracket challenge", "NCAA bracket", "March Madness", "bracket pool"],
  },
  "bracket-challenge": {
    title: "NCAA Bracket Challenge – Pools & AI Analysis | AllFantasy",
    description:
      "Create and join bracket pools. AI bracket review and simulation. Live standings and leaderboards.",
    canonical: BASE + "/brackets",
    keywords: ["bracket challenge", "NCAA bracket", "March Madness"],
  },
  leagues: {
    title: "League Sync & Management | AllFantasy",
    description:
      "Sync and manage your fantasy leagues. Connect Sleeper, ESPN, and more. One place for all your leagues.",
    canonical: BASE + "/leagues",
    keywords: ["fantasy league", "league sync", "league management"],
  },
  chimmy: {
    title: "Chimmy AI – Your Fantasy Sports Assistant | AllFantasy",
    description:
      "Chimmy is AllFantasy's AI fantasy assistant: draft help, trade analysis, waiver advice, matchup predictions, and league storytelling.",
    canonical: BASE + "/chimmy",
    keywords: ["Chimmy AI", "fantasy assistant", "AI fantasy", "draft help"],
  },
}

/** Get static SEO config for a page key. For sport/tool use seo-landing config. */
export function getSEOPageConfig(key: PageKey): SEOPageConfig | null {
  return STATIC_PAGES[key] ?? null
}

/** Full URL for OG image (path relative to origin). */
export function getDefaultOgImagePath(): string {
  return "/og-image.jpg"
}
