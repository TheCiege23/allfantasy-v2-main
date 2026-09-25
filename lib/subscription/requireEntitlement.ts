import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getGateDef, getUpgradeUrlWithHighlightForFeature } from "@/lib/subscription/featureGating"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import type { SubscriptionFeatureId } from "@/lib/subscription/types"

export async function requireEntitlement(
  featureId: SubscriptionFeatureId
): Promise<string | NextResponse> {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const resolver = new EntitlementResolver()
  const result = await resolver.resolveForUser(session.user.id, featureId, session.user.email)

  if (!result.hasAccess) {
    const def = getGateDef(featureId)
    const upgradeUrl = getUpgradeUrlWithHighlightForFeature(featureId)
    return NextResponse.json(
      {
        error: result.message,
        upgrade: true,
        featureId,
        upgradeUrl,
        planRequired: def.upgradeLabel,
      },
      { status: 402 }
    )
  }

  return session.user.id
}

export async function requireEntitlementOrThrow(featureId: SubscriptionFeatureId): Promise<string> {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  if (!session?.user?.id) {
    throw new Error("Not authenticated")
  }

  const resolver = new EntitlementResolver()
  const result = await resolver.resolveForUser(session.user.id, featureId, session.user.email)

  if (!result.hasAccess) {
    throw new Error(result.message)
  }

  return session.user.id
}
