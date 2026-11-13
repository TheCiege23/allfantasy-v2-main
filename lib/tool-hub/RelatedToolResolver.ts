/**
 * RelatedToolResolver — related tools for a given tool (cross-linking).
 */

import { TOOL_CONFIG, type ToolSlug } from '@/lib/seo-landing/config'

type RelatedToolLink = {
  slug: ToolSlug
  headline: string
  href: string
  openToolHref: string
}

/**
 * Get related tool links for a tool slug (from config relatedToolSlugs).
 */
export function getRelatedTools(forSlug: ToolSlug): RelatedToolLink[] {
  const c = TOOL_CONFIG[forSlug]
  const related = (c?.relatedToolSlugs ?? []).filter((slug) => slug !== forSlug)
  const seen = new Set<ToolSlug>()
  return related
    .map((slug) => {
      if (seen.has(slug)) return null
      seen.add(slug)
      const config = TOOL_CONFIG[slug]
      if (!config) return null
      return {
        slug,
        headline: config.headline,
        href: `/tools/${slug}`,
        openToolHref: config.openToolHref,
      }
    })
    .filter((r): r is RelatedToolLink => r != null)
}

