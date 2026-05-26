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

const COMMISSIONER_PLANS: SubscriptionPlanId[] = ["commissioner", "all_access", "supreme"]
const AI_PLANS: SubscriptionPlanId[] = ["pro", "all_access", "supreme"]

function hasPlan(input: WorldCupEntitlementInput, plans: SubscriptionPlanId[]) {
  const owned = input.plans ?? []
  return owned.some((plan) => plans.includes(plan))
}

export function hasWorldCupAllAccess(input: WorldCupEntitlementInput) {
  return Boolean(input.isAdmin || input.allFantasyTestAccess || hasPlan(input, ["all_access", "supreme"]))
}

export function canUseWorldCupCommissionerTools(input: WorldCupEntitlementInput) {
  return Boolean(
    hasWorldCupAllAccess(input) ||
      input.isOwner ||
      input.hasAfCommissioner ||
      hasPlan(input, COMMISSIONER_PLANS)
  )
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
  return canUseWorldCupCommissionerTools(input)
}

export function canExportWorldCupLeaderboard(input: WorldCupEntitlementInput) {
  return canUseWorldCupCommissionerTools(input)
}

export function canUseWorldCupChat(_input: WorldCupEntitlementInput) {
  // Basic pool chat is available to all participants. AI/Chimmy private replies
  // and commissioner controls are gated separately. The API enforces membership.
  return true
}

export function resolveWorldCupEntitlementSummary(input: WorldCupEntitlementInput) {
  const commissioner = canUseWorldCupCommissionerTools(input)
  const ai = canUseWorldCupAiTools(input)

  return {
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
