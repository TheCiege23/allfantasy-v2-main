import type { ToolTier } from '@/lib/core-app/toolsHub'

/**
 * Where a Tools card stands against the viewer's plan (the Tools board's FREE / INCLUDED badge and
 * its "Included in your plan" / "Needs an upgrade" filter).
 *
 * `held` is the viewer's plans ALREADY EXPANDED by `expandPlansWithBundle`, so AF Supreme counts as
 * AF Pro and AF Commissioner here exactly as it does at the paywall. Null means the plan read failed
 * or there is no viewer: then nothing is called included and nothing is called an upgrade — the card
 * shows the plan it needs, as it always did, and the filter is not drawn.
 */
export type ToolPlanStatus = 'free' | 'included' | 'upgrade' | 'unknown'

export function toolPlanStatus(tier: ToolTier, held: readonly string[] | null): ToolPlanStatus {
  if (tier === 'free') return 'free'
  if (tier === 'unknown' || held == null) return 'unknown'
  return held.includes(tier) ? 'included' : 'upgrade'
}

export type ToolPlanFilter = 'all' | 'included' | 'upgrade'

export function matchesToolPlanFilter(status: ToolPlanStatus, filter: ToolPlanFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'included') return status === 'free' || status === 'included'
  return status === 'upgrade'
}
