import { getPublicSiteOrigin } from '@/lib/site-public-origin'

/**
 * PROMPT 229 — Discovery SEO pages for fantasy football, basketball, and baseball leagues.
 * Routes: /fantasy-football/leagues, /fantasy-basketball/leagues, /fantasy-baseball/leagues
 */

// Resolved through getPublicSiteOrigin(); see lib/seo-landing/config.ts for why
// the hardcoded apex was wrong.
const BASE = getPublicSiteOrigin()

export type DiscoveryLeaguesSlug = 'fantasy-football' | 'fantasy-basketball' | 'fantasy-baseball'

export interface DiscoveryLeaguesFaqItem {
  question: string
  answer: string
}

export interface DiscoveryLeaguesPageConfig {
  slug: DiscoveryLeaguesSlug
  title: string
  description: string
  headline: string
  body: string
  sportLabel: string
  /** Path to discover leagues filtered by this sport (e.g. /discover/leagues/nfl). */
  discoverHref: string
  keywords: string[]
  faq: DiscoveryLeaguesFaqItem[]
}

export const DISCOVERY_LEAGUES_SLUGS: DiscoveryLeaguesSlug[] = [
  'fantasy-football',
  'fantasy-basketball',
  'fantasy-baseball',
]

export const DISCOVERY_LEAGUES_PAGE_CONFIG: Record<DiscoveryLeaguesSlug, DiscoveryLeaguesPageConfig> = {
  'fantasy-football': {
    slug: 'fantasy-football',
    title: 'Fantasy Football Leagues – Find & Join NFL Leagues | AllFantasy',
    description:
      'Discover and join fantasy football leagues on AllFantasy. Browse public NFL leagues, creator leagues, and open leagues. AI tools for drafts, trades, and waivers included.',
    headline: 'Fantasy Football Leagues',
    sportLabel: 'Fantasy Football',
    body:
      'Find and join fantasy football leagues that fit your style. AllFantasy hosts public and creator-run NFL leagues you can browse by format and join before they fill. Every league comes with AI trade analysis, mock drafts, and waiver advice so you can compete with better tools.',
    discoverHref: '/discover/leagues/nfl',
    keywords: [
      'fantasy football leagues',
      'NFL fantasy leagues',
      'join fantasy football league',
      'public fantasy football leagues',
      'fantasy football league finder',
    ],
    faq: [
      {
        question: 'How do I join a fantasy football league on AllFantasy?',
        answer:
          'Open the NFL discovery page, review available public and creator leagues, and use the join button on any open league card.',
      },
      {
        question: 'Are there free and paid fantasy football leagues?',
        answer:
          'Yes. You can filter by free or paid leagues and choose the format that matches your draft and competition preferences.',
      },
      {
        question: 'Does AllFantasy include AI tools for football leagues?',
        answer:
          'Yes. Supported football leagues include optional AI features for draft help, trade analysis, and waiver guidance.',
      },
    ],
  },
  'fantasy-basketball': {
    slug: 'fantasy-basketball',
    title: 'Fantasy Basketball Leagues – Find & Join NBA Leagues | AllFantasy',
    description:
      'Discover and join fantasy basketball leagues on AllFantasy. Browse public NBA leagues, creator leagues, and open leagues. AI tools for trades, waivers, and power rankings included.',
    headline: 'Fantasy Basketball Leagues',
    sportLabel: 'Fantasy Basketball',
    body:
      'Find and join fantasy basketball leagues that fit your style. AllFantasy hosts public and creator-run NBA leagues you can browse by format and join before they fill. Every league comes with AI trade analysis, waiver advice, and power rankings so you can compete with better tools.',
    discoverHref: '/discover/leagues/nba',
    keywords: [
      'fantasy basketball leagues',
      'NBA fantasy leagues',
      'join fantasy basketball league',
      'public fantasy basketball leagues',
      'fantasy basketball league finder',
    ],
    faq: [
      {
        question: 'Where can I find open fantasy basketball leagues?',
        answer:
          'Use the NBA discovery page to browse open leagues, then filter by style, entry type, and ranking fit to find the right room.',
      },
      {
        question: 'Can I join creator-run fantasy basketball leagues?',
        answer:
          'Yes. Creator leagues are included in discovery and can be joined directly when they are open and match your join requirements.',
      },
      {
        question: 'What tools are available for fantasy basketball managers?',
        answer:
          'AllFantasy includes optional AI and deterministic tools for trade decisions, waiver moves, rankings, and draft preparation.',
      },
    ],
  },
  'fantasy-baseball': {
    slug: 'fantasy-baseball',
    title: 'Fantasy Baseball Leagues – Find & Join MLB Leagues | AllFantasy',
    description:
      'Discover and join fantasy baseball leagues on AllFantasy. Browse public MLB leagues, creator leagues, and open leagues. AI tools for trades, waivers, and dynasty included.',
    headline: 'Fantasy Baseball Leagues',
    sportLabel: 'Fantasy Baseball',
    body:
      'Find and join fantasy baseball leagues that fit your style. AllFantasy hosts public and creator-run MLB leagues you can browse by format and join before they fill. Every league comes with AI trade analysis, waiver advice, and Chimmy AI so you can compete with better tools.',
    discoverHref: '/discover/leagues/mlb',
    keywords: [
      'fantasy baseball leagues',
      'MLB fantasy leagues',
      'join fantasy baseball league',
      'public fantasy baseball leagues',
      'fantasy baseball league finder',
    ],
    faq: [
      {
        question: 'How do I find fantasy baseball leagues for my skill level?',
        answer:
          'Browse the MLB discovery feed, then use sport and format filters to locate leagues that match your preferred style and entry profile.',
      },
      {
        question: 'Do fantasy baseball leagues support dynasty formats?',
        answer:
          'Yes. Baseball discovery includes multiple league styles, including dynasty-friendly options when available.',
      },
      {
        question: 'Can I join both public and creator baseball leagues?',
        answer:
          'Yes. AllFantasy discovery includes both public and creator-hosted baseball leagues so you can choose the experience you want.',
      },
    ],
  },
}

export function getDiscoveryLeaguesCanonical(slug: DiscoveryLeaguesSlug): string {
  return `${BASE}/${slug}/leagues`
}
