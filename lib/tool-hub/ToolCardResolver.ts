/**
 * ToolCardResolver — build card display props from tool slug for hub and tool landing.
 */

import { TOOL_CONFIG, type ToolSlug } from '@/lib/seo-landing/config'
import type { ToolCardDisplay } from './types'
import { getCategoriesForTool, getCategoryForTool } from './FeaturedToolResolver'
import { getOpenToolHref, getToolLandingPath } from './ToolDiscoveryNavigationService'

export function getToolCardDisplay(slug: ToolSlug): ToolCardDisplay | null {
  const c = TOOL_CONFIG[slug]
  if (!c) return null
  const category = getCategoryForTool(slug)
  return {
    slug,
    headline: c.headline,
    description: c.description,
    openToolHref: getOpenToolHref(slug),
    toolLandingHref: getToolLandingPath(slug),
    category,
    categories: getCategoriesForTool(slug),
    icon: c.icon,
    badge: c.badge,
  }
}

