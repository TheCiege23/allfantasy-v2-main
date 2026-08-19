/**
 * PROMPT 161 — AI tool SEO landing pages config.
 * Routes: /trade-analyzer, /waiver-wire, /draft-helper, /player-comparison, /matchup-simulator, /fantasy-coach
 */

export interface AIToolSeoConfig {
  title: string
  description: string
  headline: string
  body: string
  benefits: string[]
  screenshots: Array<{
    src: string
    alt: string
    caption: string
  }>
  openToolHref: string
  openToolLabel: string
}

export const AI_TOOL_PAGES = {
  'trade-analyzer': {
    title: 'Trade Analyzer – Smarter Fantasy Trade Grades | AllFantasy',
    description:
      'AllFantasy trade analyzer evaluates fantasy trades with Chimmy-powered grades, lineup impact, and counter-offer suggestions. NFL, NBA, MLB, NHL, and more.',
    headline: 'Trade Analyzer',
    body:
      'Evaluate fantasy trades with AI-powered grades and context-aware analysis. Get fairness scores, lineup impact, and smarter counter-offers so you can stop arguing in the group chat and show the receipts.',
    benefits: [
      'Letter grades and explanations for both sides of any trade',
      'Lineup impact and replacement value in your league context',
      'Counter-offer suggestions to maximize value',
      'Works for redraft and dynasty across NFL, NBA, MLB, NHL, NCAA, and soccer',
    ],
    screenshots: [
      {
        src: '/branding/allfantasy-ai-for-fantasy-sports-logo.png',
        alt: 'Trade Analyzer screenshot showing AI trade fairness result',
        caption: 'Example AI trade fairness output with decision context.',
      },
      {
        src: '/branding/allfantasy-colorful-logo.png',
        alt: 'Trade Analyzer screenshot showing lineup impact details',
        caption: 'Lineup impact and replacement-value insights in one view.',
      },
    ],
    openToolHref: '/trade-evaluator',
    openToolLabel: 'Open Trade Analyzer',
  },
  'waiver-wire': {
    title: 'Waiver Wire AI – Pickup & Lineup Recommendations | AllFantasy',
    description:
      'AllFantasy waiver wire AI gives pickup and lineup recommendations tuned to your league. Get waiver priorities and start/sit help powered by AI.',
    headline: 'Waiver Wire AI',
    body:
      'Get AI-powered waiver wire and free-agent recommendations based on your league settings and roster needs. Prioritize pickups and optimize your lineup with context-aware advice.',
    benefits: [
      'Waiver and free-agent pickup priorities for your league',
      'Lineup optimization and start/sit suggestions',
      'Scoring and roster context considered',
      'Available inside the AllFantasy Sports App',
    ],
    screenshots: [
      {
        src: '/branding/allfantasy-colorful-logo.png',
        alt: 'Waiver Wire AI screenshot showing top pickup recommendations',
        caption: 'Prioritized waiver recommendations based on team context.',
      },
      {
        src: '/branding/allfantasy-crest-chatgpt.png',
        alt: 'Waiver Wire AI screenshot showing start and sit guidance',
        caption: 'Start/sit and role guidance for upcoming matchups.',
      },
    ],
    openToolHref: '/waiver-ai',
    openToolLabel: 'Open Waiver Wire AI',
  },
  'draft-helper': {
    title: 'Draft Helper – AI Draft Assistant & Mock Drafts | AllFantasy',
    description:
      'AllFantasy draft helper: run mock drafts, get AI pick suggestions, and use Chimmy for real-time draft strategy. Snake and auction, multiple sports.',
    headline: 'Draft Helper',
    body:
      'Draft smarter with AI: run mock drafts, get real-time rankings and pick suggestions, and ask Chimmy for strategy during your draft. Supports snake and auction for NFL, NBA, MLB, and more.',
    benefits: [
      'Mock drafts (snake and auction) with AI suggestions',
      'Real-time rankings and strategy tips',
      'Chimmy AI for draft questions and guidance',
      'Practice before your real draft day',
    ],
    screenshots: [
      {
        src: '/branding/allfantasy-crest-chatgpt.png',
        alt: 'Draft Helper screenshot showing live draft board and pick recommendations',
        caption: 'Live board + AI pick suggestions for every draft round.',
      },
      {
        src: '/branding/allfantasy-ai-for-fantasy-sports-logo.png',
        alt: 'Draft Helper screenshot showing pre-draft tiers and strategy',
        caption: 'Tier views and strategy recommendations before draft day.',
      },
    ],
    openToolHref: '/mock-draft',
    openToolLabel: 'Open Draft Helper',
  },
  'player-comparison': {
    title: 'Player Comparison Lab – Side-by-Side Fantasy Analysis | AllFantasy',
    description:
      'AllFantasy player comparison lab: compare players side-by-side with projections, trends, and AI insights. Built for redraft and dynasty.',
    headline: 'Player Comparison Lab',
    body:
      'Compare fantasy players side-by-side with projections, usage trends, and outlook. Use the lab to decide between similar players, evaluate trade targets, or plan waiver pickups.',
    benefits: [
      'Compare up to several players at once',
      'Projections, trends, and ROS outlook',
      'Injury and usage context',
      'Available in the AllFantasy Sports App',
    ],
    screenshots: [
      {
        src: '/branding/allfantasy-wordmark-logo.png',
        alt: 'Player Comparison Lab screenshot with side-by-side player metrics',
        caption: 'Side-by-side stats, projections, and role comparisons.',
      },
      {
        src: '/branding/allfantasy-colorful-logo.png',
        alt: 'Player Comparison Lab screenshot with trend and outlook chart',
        caption: 'Trend and rest-of-season outlook to support your decisions.',
      },
    ],
    openToolHref: '/player-comparison-lab',
    openToolLabel: 'Open Player Comparison Lab',
  },
  'matchup-simulator': {
    title: 'Matchup Simulator – Fantasy Projections & Scenarios | AllFantasy',
    description:
      'AllFantasy matchup simulator: run season and playoff scenarios, project head-to-head outcomes, and explore dynasty simulations. Data-driven fantasy decisions.',
    headline: 'Matchup Simulator',
    body:
      'Simulate matchups, seasons, and playoff scenarios with the AllFantasy simulation lab. Project head-to-head outcomes and explore dynasty scenarios so you can make data-driven decisions.',
    benefits: [
      'Season and playoff simulations',
      'Head-to-head and scoring projections',
      'Dynasty scenario modeling',
      'Part of the AllFantasy Sports App',
    ],
    screenshots: [
      {
        src: '/branding/allfantasy-legacy-tool-logo.png',
        alt: 'Matchup Simulator screenshot showing projected matchup outcomes',
        caption: 'Projected outcomes and score ranges for weekly matchups.',
      },
      {
        src: '/branding/allfantasy-colorful-logo.png',
        alt: 'Matchup Simulator screenshot with playoff scenario simulation',
        caption: 'Playoff path and scenario simulation for strategic planning.',
      },
    ],
    openToolHref: '/app/simulation-lab',
    openToolLabel: 'Open Matchup Simulator',
  },
  'fantasy-coach': {
    title: 'Fantasy Coach – AI Strategy & Lineup Help | AllFantasy',
    description:
      'AllFantasy fantasy coach: get AI coaching, strategy advice, and lineup help tailored to your league. Your AI co-GM for trades, waivers, and draft.',
    headline: 'Fantasy Coach',
    body:
      'Get AI coaching and strategy advice tailored to your leagues. The fantasy coach helps with trades, waivers, lineup decisions, and draft strategy—like having a co-GM in your pocket.',
    benefits: [
      'AI coaching and strategy tailored to your league',
      'Trade, waiver, and lineup advice',
      'Draft strategy and real-time guidance',
      'Available in the AllFantasy Sports App',
    ],
    screenshots: [
      {
        src: '/branding/allfantasy-robot-king.png',
        alt: 'Fantasy Coach screenshot showing AI weekly strategy guidance',
        caption: 'Weekly AI coaching with actionable lineup and roster steps.',
      },
      {
        src: '/branding/allfantasy-ai-for-fantasy-sports-logo.png',
        alt: 'Fantasy Coach screenshot showing waiver and trade recommendations',
        caption: 'Unified coaching across waivers, trades, and draft decisions.',
      },
    ],
    openToolHref: '/app/coach',
    openToolLabel: 'Open Fantasy Coach',
  },
  'war-room': {
    title: 'Draft War Room – AI Draft Command Center | AllFantasy',
    description:
      'AllFantasy draft war room: your AI-powered draft command center. Real-time board, AI pick suggestions, Chimmy strategy, snake and auction. NFL, NBA, MLB, and more.',
    headline: 'Draft War Room',
    body:
      'Your draft command center with AI. Run mock drafts, see real-time boards, get AI pick suggestions, and ask Chimmy for strategy—all in one war room. Snake and auction for every major sport.',
    benefits: [
      'Real-time draft board and pick tracking',
      'AI pick suggestions and rankings',
      'Chimmy AI for in-draft strategy and questions',
      'Snake and auction; NFL, NBA, MLB, NHL, NCAA, Soccer',
    ],
    screenshots: [
      {
        src: '/branding/allfantasy-crest-chatgpt.png',
        alt: 'Draft War Room screenshot showing draft control center',
        caption: 'All draft controls, tiers, and recommendations in one screen.',
      },
      {
        src: '/branding/allfantasy-colorful-logo.png',
        alt: 'Draft War Room screenshot with AI strategic draft assistant',
        caption: 'Real-time AI strategy for each pick and roster build.',
      },
    ],
    openToolHref: '/mock-draft',
    openToolLabel: 'Open War Room',
  },
  'ai-chat': {
    title: 'AI Chat – Fantasy Sports Assistant (Chimmy) | AllFantasy',
    description:
      'AllFantasy AI chat: talk to Chimmy for draft help, trade analysis, waiver advice, and matchup predictions. Your fantasy sports assistant for every league.',
    headline: 'AI Chat',
    body:
      'Chat with AllFantasy’s AI assistant for draft strategy, trade grades, waiver priorities, and matchup advice. Ask in plain language—Chimmy knows your league context and every major sport.',
    benefits: [
      'Draft help and real-time strategy',
      'Trade analysis and counter-offer ideas',
      'Waiver and lineup recommendations',
      'Sport-specific guidance: NFL, NBA, MLB, NHL, NCAA, Soccer',
    ],
    screenshots: [
      {
        src: '/branding/allfantasy-robot-king.png',
        alt: 'AI Chat screenshot with Chimmy fantasy assistant',
        caption: 'Ask Chimmy for instant fantasy advice in plain language.',
      },
      {
        src: '/branding/allfantasy-ai-for-fantasy-sports-logo.png',
        alt: 'AI Chat screenshot showing multi-topic fantasy guidance',
        caption: 'One AI assistant for drafts, trades, waivers, and matchups.',
      },
    ],
    openToolHref: '/chimmy',
    openToolLabel: 'Chat with Chimmy',
  },
} as const satisfies Record<string, AIToolSeoConfig>

export type AIToolPageSlug = keyof typeof AI_TOOL_PAGES

export const AI_TOOL_PAGE_SLUGS: AIToolPageSlug[] = [
  'trade-analyzer',
  'waiver-wire',
  'draft-helper',
  'war-room',
  'ai-chat',
  'player-comparison',
  'matchup-simulator',
  'fantasy-coach',
]

const BASE = 'https://allfantasy.ai'

export function getAIToolPageCanonical(slug: AIToolPageSlug): string {
  return `${BASE}/${slug}`
}

/** WebPage JSON-LD for AI tool landing pages (SEO). */
export function getAIToolPageJsonLd(slug: AIToolPageSlug): Record<string, unknown> {
  const config = AI_TOOL_PAGES[slug]
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: config.headline,
    description: config.description,
    url: getAIToolPageCanonical(slug),
    isPartOf: {
      '@type': 'WebSite',
      name: 'AllFantasy',
      url: BASE,
    },
  }
}
