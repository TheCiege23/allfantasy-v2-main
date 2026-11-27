/**
 * Shared harness for the entitlement-matrix tests (2026-11-27): one viewer per customer tier, resolved
 * through the REAL plan rules (`hasFeatureAccessForPlans`, so Supreme's inheritance is the shipped one)
 * with only the database read replaced. Not a test file itself.
 *
 *   vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('./tierMatrixHarness')).resolverModule())
 *   setTier('legacy')
 */
import type { EntitlementStatus, SubscriptionFeatureId, SubscriptionPlanId } from '@/lib/subscription/types'

export type Tier = 'free' | 'pro' | 'commissioner' | 'legacy' | 'supreme'
export const TIERS: readonly Tier[] = ['free', 'pro', 'commissioner', 'legacy', 'supreme']

export const PLANS_BY_TIER: Record<Tier, SubscriptionPlanId[]> = {
  free: [],
  pro: ['pro'],
  commissioner: ['commissioner'],
  legacy: ['war_room'],
  supreme: ['supreme'],
}

const state: { tier: Tier } = { tier: 'free' }
export function setTier(tier: Tier): void {
  state.tier = tier
}
export function currentTier(): Tier {
  return state.tier
}

export function snapshotFor(tier: Tier) {
  const plans = PLANS_BY_TIER[tier]
  return {
    plans,
    status: (plans.length ? 'active' : 'none') as EntitlementStatus,
    currentPeriodEnd: null,
    gracePeriodEnd: null,
  }
}

export async function resolverModule() {
  const access = await import('@/lib/subscription/feature-access')
  class EntitlementResolver {
    async resolveSnapshot() {
      return snapshotFor(state.tier)
    }
    async resolveForUser(_userId: string, featureId?: SubscriptionFeatureId) {
      const entitlement = snapshotFor(state.tier)
      const hasAccess = featureId
        ? access.hasFeatureAccessForPlans(entitlement.plans, entitlement.status, featureId)
        : access.isActiveOrGraceStatus(entitlement.status)
      return { entitlement, hasAccess, message: hasAccess ? 'Access granted.' : 'Upgrade to access this feature.' }
    }
  }
  return { EntitlementResolver }
}

/** Which tiers a feature key opens, read off the shipped rules — the table the owner signs off. */
export async function tiersFor(featureId: SubscriptionFeatureId): Promise<Tier[]> {
  const access = await import('@/lib/subscription/feature-access')
  return TIERS.filter((t) => {
    const s = snapshotFor(t)
    return access.hasFeatureAccessForPlans(s.plans, s.status, featureId)
  })
}
