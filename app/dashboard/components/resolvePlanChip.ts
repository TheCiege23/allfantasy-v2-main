import type { useEntitlements } from '@/hooks/useEntitlements'
import { getDisplayPlanName, resolveHighestPlanId } from '@/lib/subscription/feature-access'

export type PlanChip = { label: string; dotClass: string }

const DOT_CLASS_BY_PLAN: Record<string, string> = {
  supreme: 'bg-purple-400',
  commissioner: 'bg-amber-400',
  pro: 'bg-cyan-400',
  war_room: 'bg-blue-400',
}

/**
 * Shared by DashboardHeaderControls and RightControlPanel, which previously each hand-copied
 * an identical priority chain with their own hardcoded plan-name strings. Extracting this pure,
 * stateless resolver doesn't reintroduce the coupling DashboardHeaderControls' own file comment
 * warns against (removing that component still can't affect RightControlPanel, or vice versa) —
 * it only removes a second literal copy of the same plan-name lookup getDisplayPlanName already
 * provides canonically. Resolves the label and dot color from the same single highest-plan value
 * so they can never disagree.
 */
export function resolvePlanChip(ents: ReturnType<typeof useEntitlements>): PlanChip | null {
  if (ents.loading) return null
  const highest = resolveHighestPlanId(ents.snapshot?.plans)
  if (!highest) return { label: 'Free', dotClass: 'bg-white/30' }
  return { label: getDisplayPlanName(highest), dotClass: DOT_CLASS_BY_PLAN[highest] ?? 'bg-cyan-400' }
}
