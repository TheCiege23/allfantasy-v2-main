import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import type { EntitlementStatus, SubscriptionPlanId } from '@/lib/subscription/types'
import { isActiveOrGraceStatus } from '@/lib/subscription/feature-access'

/**
 * Maps billing `SubscriptionPlanId` sets to AF tournament UI tiers (Pro / Commissioner / Supreme).
 * Supreme → Supreme; Pro + Commissioner-class → Supreme; single tier → that tier.
 */
export function resolveAfPlanFromEntitlement(
  plans: SubscriptionPlanId[],
  status: EntitlementStatus,
): AfPlanId | null {
  if (!isActiveOrGraceStatus(status)) return null
  const set = new Set(plans)
  if (set.has('supreme')) return 'af_supreme'

  const hasPro = set.has('pro')
  const hasCommissionerClass = set.has('commissioner') || set.has('war_room')

  if (hasPro && hasCommissionerClass) return 'af_supreme'
  if (hasCommissionerClass) return 'af_commissioner'
  if (hasPro) return 'af_pro'
  return null
}

export function hasAfCommissionerTier(plan: AfPlanId | null | undefined): boolean {
  return plan === 'af_commissioner' || plan === 'af_supreme'
}

export function hasAfProTier(plan: AfPlanId | null | undefined): boolean {
  return plan === 'af_pro' || plan === 'af_supreme'
}

/** AF Supreme — the top bundle tier (see `resolveAfPlanFromEntitlement`). */
export function hasAfSupremeTier(plan: AfPlanId | null | undefined): boolean {
  return plan === 'af_supreme'
}
