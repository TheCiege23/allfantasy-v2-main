import type {
  EntitlementStatus,
  SubscriptionFeatureId,
  SubscriptionPlanId,
} from '@/lib/subscription/types'
import { resolveAccessTier, type AccessTier } from '@/lib/access/accessTier'
import {
  buildFeatureUpgradePath,
  expandPlansWithBundle,
  getDisplayPlanName,
  getDisplayPlanNameWithPrice,
  getRequiredPlanForFeature,
  hasFeatureAccessForPlans,
} from '@/lib/subscription/feature-access'

/**
 * canAccess — the single entitlement gate seam (AF_GATE0 §3.4).
 *
 * "Add one gate function, e.g. canAccess(feature, context), returning free for
 *  trial/free users and a locked result for paid features. Centralize it — every
 *  gated surface calls this, nothing checks tiers inline."
 *
 * This is a PURE, isomorphic function (safe on server and client — it only touches
 * `feature-access` + `accessTier`, both already client-safe). It delegates the actual
 * plan/feature decision to the proven `hasFeatureAccessForPlans` / `getRequiredPlanForFeature`
 * primitives rather than re-implementing them, so the follow-on tier/billing engine slots
 * in by enriching the `context` (or those primitives) without re-plumbing any call site.
 *
 * Callers supply the entitlement `context`:
 *  - Client: assemble from `useOptionalSession()` + `useEntitlements().snapshot` (see `useCanAccess`).
 *  - Server: assemble from `EntitlementResolver.resolveSnapshot(userId)` (see `canAccessForUser`).
 */

export interface CanAccessContext {
  /** Is there a signed-in AllFantasy account? (false = guest/trial visitor). */
  isAuthenticated: boolean
  /** Active (or grace) subscription plans the user holds. Empty for guest/free. */
  plans?: readonly SubscriptionPlanId[]
  /** Entitlement status; defaults to 'none' (guest/free). */
  status?: EntitlementStatus
  /** Optional path to come back to after signup/upgrade — used to build the CTA href. */
  returnTo?: string
}

export type CanAccessReason =
  /** Feature requires no paid plan — available to every tier, including guest/trial. */
  | 'free-feature'
  /** Paid feature the user is entitled to (holds the plan or an inheriting bundle). */
  | 'entitled'
  /** Paid feature, guest/trial visitor — the unlock is to create a free account. */
  | 'requires-signup'
  /** Paid feature, signed-in free (or insufficient-tier) user — the unlock is to upgrade. */
  | 'requires-upgrade'

export interface CanAccessResult {
  /** True if the caller should render the real feature. */
  allowed: boolean
  /** Convenience inverse of `allowed`, for locked-preview components. */
  locked: boolean
  tier: AccessTier
  isGuest: boolean
  /** The plan that would unlock this feature (null for free features). */
  requiredPlan: SubscriptionPlanId | null
  /** Human label for the required plan, e.g. "AF Pro — $9.99/mo" (null for free features). */
  requiredPlanLabel: string | null
  reason: CanAccessReason
  /** Suggested CTA label for a locked preview ('' when allowed). */
  ctaLabel: string
  /** Where the CTA sends the user: `/signup` for guests, the upgrade path for free users ('' when allowed). */
  ctaHref: string
}

const ALLOWED_CTA = { ctaLabel: '', ctaHref: '' } as const

export function canAccess(
  feature: SubscriptionFeatureId,
  context: CanAccessContext,
): CanAccessResult {
  const plans = context.plans ?? []
  const status: EntitlementStatus = context.status ?? 'none'
  const expanded = expandPlansWithBundle(plans)

  const tierResult = resolveAccessTier({
    isAuthenticated: context.isAuthenticated,
    hasPro: expanded.includes('pro'),
    hasCommissioner: expanded.includes('commissioner'),
    hasWarRoom: expanded.includes('war_room'),
    hasSupreme: expanded.includes('supreme'),
  })

  const requiredPlan = getRequiredPlanForFeature(feature)

  // Free feature — available to everyone (guest/free/paid). This is the trial-mode
  // path for the surfaces AF_GATE0 marks Free (board, unified view, basic attention/
  // search/legacy): they resolve `allowed: true` with no signup wall.
  if (!requiredPlan) {
    return {
      allowed: true,
      locked: false,
      tier: tierResult.tier,
      isGuest: tierResult.isGuest,
      requiredPlan: null,
      requiredPlanLabel: null,
      reason: 'free-feature',
      ...ALLOWED_CTA,
    }
  }

  // Paid feature the user is already entitled to.
  if (hasFeatureAccessForPlans(plans, status, feature)) {
    return {
      allowed: true,
      locked: false,
      tier: tierResult.tier,
      isGuest: tierResult.isGuest,
      requiredPlan,
      requiredPlanLabel: getDisplayPlanNameWithPrice(requiredPlan),
      reason: 'entitled',
      ...ALLOWED_CTA,
    }
  }

  // Locked. Guests/trial visitors get a "sign up free" CTA (the account moment);
  // signed-in free users get the upgrade path. Never a dead end (AF_GATE0 §2.6).
  const requiredPlanLabel = getDisplayPlanNameWithPrice(requiredPlan)
  const nextQuery = context.returnTo ? `?next=${encodeURIComponent(context.returnTo)}` : ''

  if (tierResult.isGuest) {
    return {
      allowed: false,
      locked: true,
      tier: tierResult.tier,
      isGuest: true,
      requiredPlan,
      requiredPlanLabel,
      reason: 'requires-signup',
      ctaLabel: 'Sign up free',
      ctaHref: `/signup${nextQuery}`,
    }
  }

  return {
    allowed: false,
    locked: true,
    tier: tierResult.tier,
    isGuest: false,
    requiredPlan,
    requiredPlanLabel,
    reason: 'requires-upgrade',
    ctaLabel: `Unlock with ${getDisplayPlanName(requiredPlan)}`,
    ctaHref: buildFeatureUpgradePath(feature),
  }
}
