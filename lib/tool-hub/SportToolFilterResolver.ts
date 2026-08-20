/**
 * SportToolFilterResolver — sport-aware tool filtering for the hub.
 */

import { SPORT_CONFIG, SPORT_SLUGS, type SportSlug, type ToolSlug } from '@/lib/seo-landing/config'
import { getAllTools } from './ToolHubService'

const UNIVERSAL_TOOL_SLUGS: ToolSlug[] = ['league-transfer', 'trade-finder', 'career-share', 'season-strategy']

export type SportFilterOption = {
  slug: SportSlug
  label: string
  leagueSport: string
}

/**
 * All sport filter options (for hub dropdown).
 */
export function getSportFilterOptions(): SportFilterOption[] {
  return SPORT_SLUGS.map((slug) => ({
    slug,
    label: SPORT_CONFIG[slug].headline,
    leagueSport: SPORT_CONFIG[slug].leagueSport,
  }))
}

/**
 * Tool slugs that are linked from a sport's landing page (toolHrefs).
 * Used to filter "tools for this sport" when a sport is selected.
 */
function getToolHrefsSet(sportSlug: SportSlug): Set<string> {
  const config = SPORT_CONFIG[sportSlug]
  if (!config?.toolHrefs?.length) return new Set()
  return new Set(config.toolHrefs.map((h) => normalizeHref(h.href)))
}

function normalizeHref(href: string): string {
  const raw = String(href || '').trim().toLowerCase()
  if (!raw) return ''
  const [pathAndQuery] = raw.split('#')
  return pathAndQuery.endsWith('/') && pathAndQuery !== '/' ? pathAndQuery.slice(0, -1) : pathAndQuery
}

const HREF_TOOL_ALIASES: Record<string, ToolSlug> = {
  '/trade-analyzer': 'trade-analyzer',
  '/trade-evaluator': 'trade-analyzer',
  '/trade-finder': 'trade-finder',
  '/mock-draft': 'mock-draft-simulator',
  '/waiver-ai': 'waiver-wire-advisor',
  '/waiver-wire': 'waiver-wire-advisor',
  '/manager-compare': 'manager-compare',
  '/social-pulse': 'social-pulse',
  '/career-share': 'career-share',
  '/season-strategy': 'season-strategy',
  '/legacy?tab=mock-draft': 'ai-draft-assistant',
  '/app/simulation-lab': 'matchup-simulator',
  '/matchup-simulator': 'matchup-simulator',
  '/app/power-rankings': 'power-rankings',
  '/bracket': 'bracket-challenge',
  '/brackets': 'bracket-challenge',
  '/af-legacy': 'legacy-dynasty',
}

function resolveToolSlugFromHref(href: string, allToolSlugsByHref: Map<string, ToolSlug>): ToolSlug | null {
  const normalized = normalizeHref(href)
  if (!normalized) return null
  if (HREF_TOOL_ALIASES[normalized]) return HREF_TOOL_ALIASES[normalized]
  const direct = allToolSlugsByHref.get(normalized)
  if (direct) return direct
  return null
}

/**
 * For a given sport, return tool slugs that are relevant (appear in that sport's toolHrefs).
 * If no tool has matching openToolHref, return all tool slugs so we never show empty.
 */
export function getToolSlugsForSport(sportSlug: SportSlug | null): ToolSlug[] {
  if (!sportSlug) return getAllTools().map((t) => t.slug)
  const hrefSet = getToolHrefsSet(sportSlug)
  const all = getAllTools()
  const allToolSlugsByHref = new Map(all.map((tool) => [normalizeHref(tool.openToolHref), tool.slug]))
  const slugs = new Set<ToolSlug>()

  for (const href of hrefSet) {
    const slug = resolveToolSlugFromHref(href, allToolSlugsByHref)
    if (slug) slugs.add(slug)
  }

  for (const slug of UNIVERSAL_TOOL_SLUGS) {
    slugs.add(slug)
  }

  if (slugs.size > 0) return Array.from(slugs)
  return all.map((t) => t.slug)
}
