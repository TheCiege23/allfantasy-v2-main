/**
 * Retired /tools/<slug> landing URLs and where they now live.
 *
 * Owner decision 2026-10-20: the `matchup-simulator` tool card was renamed `simulation-lab`, so its
 * public SEO page moved from /tools/matchup-simulator to /tools/simulation-lab. The old URL is a
 * permanent (308) redirect so rankings and existing links carry over
 * (`app/tools/matchup-simulator/page.tsx`, the same page-stub mechanism as `/matchup-simulator`).
 *
 * Kept in lib because a Next page file may only export Next's page fields.
 */
import type { ToolSlug } from '@/lib/seo-landing/config'

export const RETIRED_TOOL_SLUGS: Record<string, ToolSlug> = {
  'matchup-simulator': 'simulation-lab',
}

type SearchParams = Record<string, string | string[] | undefined>

/** `/tools/<new slug>` for a retired slug, carrying the query string across (UTM tags etc.). */
export function retiredToolRedirectTarget(oldSlug: keyof typeof RETIRED_TOOL_SLUGS, searchParams: SearchParams = {}): string {
  const target = `/tools/${RETIRED_TOOL_SLUGS[oldSlug]}`
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v)
  }
  const query = qs.toString()
  return query ? `${target}?${query}` : target
}
