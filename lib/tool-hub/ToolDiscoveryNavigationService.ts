/**
 * ToolDiscoveryNavigationService — canonical routes for tool hub and tool discovery.
 */

import { TOOL_CONFIG, type ToolSlug, type SportSlug } from '@/lib/seo-landing/config'
import { buildAIChatHref } from '@/lib/chimmy-chat/AIContextRouter'
import type { ToolCategoryId } from './types'

export const ROUTES = {
  toolsHub: () => '/tools-hub',
  toolLanding: (slug: ToolSlug) => `/tools/${slug}`,
  sportLanding: (slug: SportSlug) => `/sports/${slug}`,
  home: () => '/',
  app: () => '/app',
  bracket: () => '/brackets',
  afLegacy: () => '/af-legacy',
  chimmy: () => '/chimmy',
} as const

/**
 * Open-tool href from config (e.g. /trade-evaluator, /mock-draft).
 */
export function getOpenToolHref(slug: ToolSlug): string {
  return TOOL_CONFIG[slug]?.openToolHref ?? '/app'
}

export function getToolsHubPath(): string {
  return ROUTES.toolsHub()
}

export function getToolLandingPath(slug: ToolSlug): string {
  return ROUTES.toolLanding(slug)
}

export function getToolsHubPathWithFilters(filters: {
  sport?: SportSlug | null
  category?: ToolCategoryId | 'all' | null
}): string {
  const params = new URLSearchParams()
  if (filters.sport) params.set('sport', filters.sport)
  if (filters.category && filters.category !== 'all') params.set('category', filters.category)
  const query = params.toString()
  return query ? `${ROUTES.toolsHub()}?${query}` : ROUTES.toolsHub()
}

export function getBestToolForMeHref(): string {
  return buildAIChatHref({
    prompt: 'Which AllFantasy tool should I open next for my league and why?',
    source: 'tool_hub',
  })
}
