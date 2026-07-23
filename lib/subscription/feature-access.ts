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

export function planFamilyToSubscriptionPlanId(
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

/** The plans AF Supreme includes for entitlement checks — it inherits the full tier stack. */
export const SUPREME_INCLUDED_PLAN_IDS: readonly SubscriptionPlanId[] = [
  "pro",
  "commissioner",
  "war_room",
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

/**
 * The one shared "which paid tier wins" resolver. Supreme inherits every lower tier, so it must
 * win even when a user's `plans` array also contains commissioner/pro/war_room. Before this,
 * at least 7 call sites hand-copied this same supreme > commissioner > pro > war_room priority
 * chain with their own hardcoded display strings — every one of them correct today, but each a
 * silent opportunity for the display name to drift from getDisplayPlanName the next time a tier
 * is renamed. Returns null when the user has no recognized paid plan (caller decides the
 * free/loading/error copy, since that varies by surface).
 */
export function resolveHighestPlanId(
  plans: readonly string[] | null | undefined
): SubscriptionPlanId | null {
  if (!plans || plans.length === 0) return null
  const set = new Set(plans)
  if (set.has("supreme")) return "supreme"
  if (set.has("commissioner")) return "commissioner"
  if (set.has("pro")) return "pro"
  if (set.has("war_room")) return "war_room"
  return null
}

/** `resolveHighestPlanId` + `getDisplayPlanName` in one call. Null when no recognized paid plan. */
export function getDisplayPlanNameForPlans(
  plans: readonly string[] | null | undefined
): string | null {
  const highest = resolveHighestPlanId(plans)
  return highest ? getDisplayPlanName(highest) : null
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
  const required = getRequiredPlanForFeature(featureId)
  if (!required) return false
  return (
    expandedPlans.includes(required) ||
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
