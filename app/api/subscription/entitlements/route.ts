import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import type { SubscriptionFeatureId } from "@/lib/subscription/types"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import { isSubscriptionEntitlementBypassUserId } from "@/lib/dev-admin/access"
import {
  buildFeatureUpgradePath,
  getDisplayPlanName,
  getRequiredPlanForFeature,
  isSubscriptionFeatureId,
  resolveBundleInheritance,
} from "@/lib/subscription/feature-access"

export const dynamic = "force-dynamic"

/**
 * GET /api/subscription/entitlements
 * Returns current user's subscription entitlement for gating (useEntitlement hook).
 * Optional: ?feature=<SubscriptionFeatureId> to get hasAccess for that feature.
 * When subscription/Stripe integration is persisted, resolve from DB or Stripe here.
 */
export async function GET(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const rawFeatureId = searchParams?.get("feature")
    if (rawFeatureId && !isSubscriptionFeatureId(rawFeatureId)) {
      return NextResponse.json(
        { error: "Invalid feature id" },
        { status: 400 }
      )
    }
    const featureId = rawFeatureId ? (rawFeatureId as SubscriptionFeatureId) : undefined
    const resolver = new EntitlementResolver()
    const { entitlement, hasAccess, message } = await resolver.resolveForUser(
      session.user.id,
      featureId,
      session.user.email
    )
    const requiredPlanId = featureId ? getRequiredPlanForFeature(featureId) : null
    const requiredPlan = requiredPlanId ? getDisplayPlanName(requiredPlanId) : null
    const upgradePath = featureId ? buildFeatureUpgradePath(featureId) : "/pricing"
    const bundleInheritance = resolveBundleInheritance(entitlement.plans)
    // Mirrors /api/tokens/balance's isAdminBypassAccount: true means this snapshot's plans/status
    // are a synthetic dev-admin grant (lib/dev-admin/access.ts), not a real Stripe subscription —
    // callers must disclose this rather than render it as an indistinguishable real plan badge.
    const isAdminBypassAccount = isSubscriptionEntitlementBypassUserId(
      session.user.id,
      session.user.email
    )

    return NextResponse.json({
      entitlement,
      bundleInheritance,
      hasAccess: Boolean(hasAccess),
      message: String(message ?? "Upgrade to access this feature."),
      requiredPlan,
      upgradePath,
      isAdminBypassAccount,
    })
  } catch (e) {
    console.error("[subscription/entitlements GET]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Failed to load entitlements" },
      { status: 500 }
    )
  }
}

