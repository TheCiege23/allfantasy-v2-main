/**
 * FeaturedToolResolver — featured/trending tools and category grouping for the hub.
 */

import type { ToolSlug } from '@/lib/seo-landing/config'
import type { ToolCategoryId } from './types'

const CATEGORY_LABELS: Record<ToolCategoryId, string> = {
  trade: 'Trade',
  waiver: 'Waiver & Lineup',
  draft: 'Draft',
  simulate: 'Simulate',
  bracket: 'Bracket',
  rankings: 'Rankings',
  legacy: 'Legacy & Dynasty',
  ai: 'AI & Assistant',
  transfer: 'Transfer',
}

/** Slug → category for hub grouping. */
const TOOL_CATEGORIES: Record<ToolSlug, ToolCategoryId[]> = {
  'trade-analyzer': ['trade'],
  'trade-finder': ['trade'],
  'mock-draft-simulator': ['draft'],
  'waiver-wire-advisor': ['waiver'],
  'manager-compare': ['ai', 'rankings'],
  'social-pulse': ['ai'],
  'career-share': ['ai'],
  'season-strategy': ['ai'],
  'ai-draft-assistant': ['ai'],
  'simulation-lab': ['simulate'],
  'bracket-challenge': ['bracket'],
  'power-rankings': ['rankings'],
  'legacy-dynasty': ['legacy'],
  'league-transfer': ['transfer'],
}

/** Featured tool slugs (shown first on hub). */
const FEATURED_SLUGS: ToolSlug[] = [
  'trade-analyzer',
  'trade-finder',
  'mock-draft-simulator',
  'waiver-wire-advisor',
  'manager-compare',
  'social-pulse',
  'career-share',
  'season-strategy',
  'ai-draft-assistant',
  'league-transfer',
]

/** Trending tool slugs (shown in separate momentum rail). */
const TRENDING_SLUGS: ToolSlug[] = [
  'simulation-lab',
  'bracket-challenge',
  'power-rankings',
  'legacy-dynasty',
]

/** Category order for tabs/sections. */
export const CATEGORY_ORDER: ToolCategoryId[] = [
  'trade',
  'waiver',
  'draft',
  'simulate',
  'bracket',
  'rankings',
  'legacy',
  'ai',
  'transfer',
]

export function getCategoryLabel(id: ToolCategoryId): string {
  return CATEGORY_LABELS[id] ?? id
}

export function getCategoryForTool(slug: ToolSlug): ToolCategoryId {
  return TOOL_CATEGORIES[slug]?.[0] ?? 'legacy'
}

export function getCategoriesForTool(slug: ToolSlug): ToolCategoryId[] {
  return TOOL_CATEGORIES[slug] ?? ['legacy']
}

export function getFeaturedToolSlugs(): ToolSlug[] {
  return FEATURED_SLUGS
}

export function getTrendingToolSlugs(): ToolSlug[] {
  return TRENDING_SLUGS
}

/**
 * Tools grouped by category (for hub tabs/sections).
 */
export function getToolsByCategory(): Record<ToolCategoryId, ToolSlug[]> {
  const map: Record<ToolCategoryId, ToolSlug[]> = {
    trade: [],
    waiver: [],
    draft: [],
    simulate: [],
    bracket: [],
    rankings: [],
    legacy: [],
    ai: [],
    transfer: [],
  }
  for (const slug of Object.keys(TOOL_CATEGORIES) as ToolSlug[]) {
    for (const cat of TOOL_CATEGORIES[slug] ?? []) {
      if (!map[cat].includes(slug)) map[cat].push(slug)
    }
  }
  return map
}
