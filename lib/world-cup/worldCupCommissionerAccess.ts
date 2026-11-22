import "server-only"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import type { SubscriptionFeatureId } from "@/lib/subscription/types"

const WORLD_CUP_ADVANCED_COMMISSIONER_FEATURE: SubscriptionFeatureId = "advanced_scoring"

export async function userHasWorldCupCommissionerAccess(
  userId: string,
  email?: string | null
): Promise<boolean> {
  const resolver = new EntitlementResolver()
  const result = await resolver.resolveForUser(
    userId,
    WORLD_CUP_ADVANCED_COMMISSIONER_FEATURE,
    email ?? null
  )
  return result.hasAccess
}
