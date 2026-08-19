import type { SubscriptionPlanId } from "@/lib/subscription/types"

export type WorldCupEntitlementInput = {
  isOwner?: boolean | null
  isAdmin?: boolean | null
  hasBracketBrainAi?: boolean | null
  hasAfCommissioner?: boolean | null
  hasAfPro?: boolean | null
  plans?: SubscriptionPlanId[] | null
  allFantasyTestAccess?: boolean | null
}

const COMMISSIONER_PLANS: SubscriptionPlanId[] = ["commissioner", "supreme"]
const AI_PLANS: SubscriptionPlanId[] = ["pro", "supreme"]

function hasPlan(input: WorldCupEntitlementInput, plans: SubscriptionPlanId[]) {
  const owned = input.plans ?? []
  return owned.some((plan) => plans.includes(plan))
}

export function hasWorldCupAllAccess(input: WorldCupEntitlementInput) {
  return Boolean(input.isAdmin || input.allFantasyTestAccess || hasPlan(input, ["supreme"]))
}

export function canUseWorldCupCommissionerTools(input: WorldCupEntitlementInput) {
  return Boolean(
    hasWorldCupAllAccess(input) ||
      input.hasAfCommissioner ||
      hasPlan(input, COMMISSIONER_PLANS)
  )
}

export function canManageBasicWorldCupPool(input: WorldCupEntitlementInput) {
  return Boolean(hasWorldCupAllAccess(input) || input.isOwner)
}

export function canUseWorldCupAiTools(input: WorldCupEntitlementInput) {
  return Boolean(
    hasWorldCupAllAccess(input) ||
      input.hasBracketBrainAi ||
      input.hasAfPro ||
      hasPlan(input, AI_PLANS)
  )
}

export function canCreateMultipleWorldCupEntries(input: WorldCupEntitlementInput) {
  return true
}

export function canExportWorldCupLeaderboard(input: WorldCupEntitlementInput) {
  return canUseWorldCupCommissionerTools(input)
}

export function canUseWorldCupChat(input: WorldCupEntitlementInput) {
  return true
}

export function resolveWorldCupEntitlementSummary(input: WorldCupEntitlementInput) {
  const commissioner = canUseWorldCupCommissionerTools(input)
  const ai = canUseWorldCupAiTools(input)
  const basicCommissioner = canManageBasicWorldCupPool(input)

  return {
    basicCommissioner,
    commissioner,
    ai,
    multipleEntries: canCreateMultipleWorldCupEntries(input),
    exportLeaderboard: canExportWorldCupLeaderboard(input),
    chat: canUseWorldCupChat(input),
    labels: {
      commissioner: commissioner ? "AF Commissioner active" : "Requires AF Commissioner",
      ai: ai ? "AI/Pro active" : "Requires AI/Pro",
    },
  }
}
