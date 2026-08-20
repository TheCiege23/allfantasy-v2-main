import type {
  EntitlementStatus,
  SubscriptionFeatureId,
  SubscriptionPlanId,
} from "@/lib/subscription/types"
import type { SubscriptionPlanFamily, MonetizationSubscriptionSku } from "@/lib/monetization/catalog"
import { getMonetizationCatalogItemBySku } from "@/lib/monetization/catalog"
import { ENTITLEMENTS } from "@/lib/monetization/entitlements"
import {
  buildMonetizationUpgradePathForFeature,
  getPremiumMonetizationForFeature,
  listPremiumFeatureMonetizationMatrix,
} from "@/lib/monetization/feature-monetization-matrix"

const PREMIUM_MONETIZATION_FEATURES = listPremiumFeatureMonetizationMatrix()

export const PRO_FEATURES: readonly SubscriptionFeatureId[] = PREMIUM_MONETIZATION_FEATURES
  .filter((entry) => entry.requiredPlanId === "pro")
  .map((entry) => entry.key)

export const COMMISSIONER_FEATURES: readonly SubscriptionFeatureId[] = PREMIUM_MONETIZATION_FEATURES
  .filter((entry) => entry.requiredPlanId === "commissioner")
  .map((entry) => entry.key)

export const WAR_ROOM_FEATURES: readonly SubscriptionFeatureId[] = PREMIUM_MONETIZATION_FEATURES
  .filter((entry) => entry.requiredPlanId === "war_room")
  .map((entry) => entry.key)

const SUBSCRIPTION_FEATURE_ID_SET = new Set<SubscriptionFeatureId>(
  PREMIUM_MONETIZATION_FEATURES.map((entry) => entry.key)
)

const ENTITLEMENT_CATALOG_ID_SET = new Set<string>(Object.keys(ENTITLEMENTS))

function planFamilyToSubscriptionPlanId(
  family: SubscriptionPlanFamily
): SubscriptionPlanId | null {
  switch (family) {
    case "af_pro":
      return "pro"
    case "af_commissioner":
      return "commissioner"
    case "af_war_room":
      return "war_room"
    case "af_supreme":
      return "supreme"
    default:
      return null
  }
}

/**
 * The plans AF Supreme includes for entitlement checks.
 *
 * ⚠ war_room (AF Legacy) WAS REMOVED FROM THIS LIST. Legacy now stands on its own
 * at $9.99/mo alongside Pro and Commissioner rather than sitting above Supreme,
 * so Supreme bundles the two general tiers and Legacy is bought separately.
 *
 * ⚠ THIS TAKES AN ENTITLEMENT AWAY FROM EXISTING SUPREME SUBSCRIBERS. Anyone on
 * Supreme today has draft-room and dynasty access through this list and loses it
 * the moment this deploys. That is a customer-communications decision, not a code
 * one — if those accounts are to be grandfathered, it has to happen here or in the
 * entitlement resolution, and it has to happen BEFORE this ships.
 */
export const SUPREME_INCLUDED_PLAN_IDS: readonly SubscriptionPlanId[] = [
  "pro",
  "commissioner",
]

export function isActiveOrGraceStatus(status: EntitlementStatus): boolean {
  return status === "active" || status === "grace"
}

export function getRequiredPlanForFeature(
  featureId: SubscriptionFeatureId
): SubscriptionPlanId | null {
  const fromMatrix = getPremiumMonetizationForFeature(featureId)
  if (fromMatrix) return fromMatrix.requiredPlanId
  const cat = ENTITLEMENTS[featureId as keyof typeof ENTITLEMENTS]
  if (!cat?.requiredPlan?.length) return null
  return planFamilyToSubscriptionPlanId(cat.requiredPlan[0])
}

/**
 * Every plan that unlocks a feature, not just the first one listed.
 *
 * The catalog has always modelled `requiredPlan` as an ARRAY, and the access
 * check read only element [0]. That was harmless for every feature shipped so
 * far: all 32 entries are [X, 'af_supreme'], and Supreme is short-circuited
 * separately, so the ignored entries never mattered. It stops being harmless the
 * moment a feature is genuinely sold on two independent plans — Manager
 * Psychology is offered on Pro and on War Room, and War Room is not a superset
 * of Pro, so reading only [0] would silently lock out every War Room subscriber.
 *
 * getRequiredPlanForFeature still returns the FIRST plan, which is the one the
 * upgrade prompts advertise; this is the set the gate actually checks.
 */
export function getAcceptedPlansForFeature(
  featureId: SubscriptionFeatureId
): SubscriptionPlanId[] {
  const fromMatrix = getPremiumMonetizationForFeature(featureId)
  if (fromMatrix) return [fromMatrix.requiredPlanId]
  const cat = ENTITLEMENTS[featureId as keyof typeof ENTITLEMENTS]
  if (!cat?.requiredPlan?.length) return []
  return cat.requiredPlan
    .map((family) => planFamilyToSubscriptionPlanId(family))
    .filter((p): p is SubscriptionPlanId => p != null)
}

export function getDisplayPlanName(planId: SubscriptionPlanId): string {
  switch (planId) {
    case "pro":
      return "AF Pro"
    case "commissioner":
      return "AF Commissioner"
    case "war_room":
      return "AF Legacy"
    case "supreme":
      return "AF Supreme"
    case "enterprise":
      return "AF Enterprise"
  }
}

const PLAN_TO_MONTHLY_SKU: Partial<Record<SubscriptionPlanId, MonetizationSubscriptionSku>> = {
  pro: "af_pro_monthly",
  commissioner: "af_commissioner_monthly",
  war_room: "af_war_room_monthly",
  supreme: "af_supreme_monthly",
}

/** "AF Pro — $9.99/mo" — every gate that names a required tier should show the price too. */
export function getDisplayPlanNameWithPrice(planId: SubscriptionPlanId): string {
  const name = getDisplayPlanName(planId)
  const sku = PLAN_TO_MONTHLY_SKU[planId]
  if (!sku) return name
  const item = getMonetizationCatalogItemBySku(sku)
  if (!item) return name
  return `${name} — $${item.amountUsd.toFixed(2)}/mo`
}

export function expandPlansWithBundle(plans: readonly SubscriptionPlanId[]): SubscriptionPlanId[] {
  const expanded = new Set<SubscriptionPlanId>(plans)
  if (expanded.has("supreme")) {
    for (const includedPlan of SUPREME_INCLUDED_PLAN_IDS) {
      expanded.add(includedPlan)
    }
  }
  return Array.from(expanded)
}

export function resolveBundleInheritance(plans: readonly SubscriptionPlanId[]): {
  hasSupreme: boolean
  inheritedPlanIds: SubscriptionPlanId[]
  effectivePlanIds: SubscriptionPlanId[]
} {
  const hasSupreme = plans.includes("supreme")
  return {
    hasSupreme,
    inheritedPlanIds: hasSupreme ? [...SUPREME_INCLUDED_PLAN_IDS] : [],
    effectivePlanIds: expandPlansWithBundle(plans),
  }
}

export function hasFeatureAccessForPlans(
  plans: readonly SubscriptionPlanId[],
  status: EntitlementStatus,
  featureId: SubscriptionFeatureId
): boolean {
  if (!isActiveOrGraceStatus(status)) return false
  const expandedPlans = expandPlansWithBundle(plans)
  const accepted = getAcceptedPlansForFeature(featureId)
  if (accepted.length === 0) return false
  return (
    accepted.some((plan) => expandedPlans.includes(plan)) ||
    expandedPlans.includes("supreme")
  )
}

export function buildFeatureUpgradePath(featureId: SubscriptionFeatureId): string {
  const cat = ENTITLEMENTS[featureId as keyof typeof ENTITLEMENTS]
  if (cat?.upgradeUrl) return cat.upgradeUrl
  return buildMonetizationUpgradePathForFeature(featureId)
}

export function isSubscriptionFeatureId(value: unknown): value is SubscriptionFeatureId {
  if (typeof value !== "string") return false
  if (SUBSCRIPTION_FEATURE_ID_SET.has(value as SubscriptionFeatureId)) return true
  return ENTITLEMENT_CATALOG_ID_SET.has(value)
}
