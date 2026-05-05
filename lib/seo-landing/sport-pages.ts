/**
 * PROMPT 162 — Sport SEO landing pages config.
 * Routes: /fantasy-football, /fantasy-basketball, /fantasy-baseball, /fantasy-hockey, /fantasy-soccer, /fantasy-ncaa
 */

import { SPORT_CONFIG, type SportSlug } from './config'

export interface SportSeoPageConfig {
  title: string
  description: string
  headline: string
  body: string
  toolHrefs: { label: string; href: string }[]
  keywords?: string[]
}

const BASE = 'https://allfantasy.ai'

/** Map flat route slug to existing SPORT_CONFIG or custom config for NCAA combined page. */
export const SPORT_PAGE_SLUGS = [
  'fantasy-football',
  'fantasy-basketball',
  'fantasy-baseball',
  'fantasy-hockey',
  'fantasy-soccer',
  'fantasy-ncaa',
] as const

export type SportPageSlug = (typeof SPORT_PAGE_SLUGS)[number]

/** NCAA combined page: NCAA Basketball + NCAA Football. */
const FANTASY_NCAA_CONFIG: SportSeoPageConfig = {
  title: 'NCAA Fantasy – Basketball & Football Tools | AllFantasy',
  description:
    'AllFantasy NCAA fantasy tools for basketball and football: bracket challenge, trade analyzer, waiver advisor, and dynasty league management for college fantasy.',
  headline: 'NCAA Fantasy – Basketball & Football',
  body:
    'AllFantasy supports NCAA Basketball and NCAA Football fantasy with bracket challenges, AI trade analysis, waiver advice, and dynasty tools. Use the Sports App for league management, the Bracket Challenge for March Madness, and the Trade Analyzer for college fantasy leagues.',
  toolHrefs: [
    { label: 'Bracket Challenge', href: '/brackets' },
    { label: 'Bracket Hub', href: '/brackets' },
    { label: 'Trade Analyzer', href: '/trade-analyzer' },
    { label: 'Waiver Advisor', href: '/waiver-ai' },
    { label: 'Sports App', href: '/discover/leagues' },
    { label: 'Legacy & Dynasty', href: '/af-legacy' },
  ],
  keywords: ['NCAA basketball fantasy', 'NCAA football fantasy', 'bracket challenge', 'March Madness', 'NCAAB', 'NCAAF'],
}

function fromSportConfig(slug: SportSlug): SportSeoPageConfig {
  const c = SPORT_CONFIG[slug]
  return {
    title: c.title,
    description: c.description,
    headline: c.headline,
    body: c.body,
    toolHrefs: c.toolHrefs,
    keywords: c.keywords,
  }
}

export const SPORT_PAGE_CONFIG: Record<SportPageSlug, SportSeoPageConfig> = {
  'fantasy-football': fromSportConfig('fantasy-football'),
  'fantasy-basketball': fromSportConfig('fantasy-basketball'),
  'fantasy-baseball': fromSportConfig('fantasy-baseball'),
  'fantasy-hockey': fromSportConfig('fantasy-hockey'),
  'fantasy-soccer': fromSportConfig('fantasy-soccer'),
  'fantasy-ncaa': FANTASY_NCAA_CONFIG,
}

export function getSportPageCanonical(slug: SportPageSlug): string {
  return `${BASE}/${slug}`
}

/** WebPage JSON-LD for flat sport SEO pages. */
export function getSportPageJsonLd(slug: SportPageSlug): Record<string, unknown> {
  const config = SPORT_PAGE_CONFIG[slug]
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: config.headline,
    description: config.description,
    url: getSportPageCanonical(slug),
    isPartOf: {
      '@type': 'WebSite',
      name: 'AllFantasy',
      url: BASE,
    },
  }
}
