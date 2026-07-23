import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import {
  buildFeatureUpgradePath,
  getDisplayPlanName,
  getRequiredPlanForFeature,
  isSubscriptionFeatureId,
  resolveBundleInheritance,
} from "@/lib/subscription/feature-access"
import type { SubscriptionFeatureId } from "@/lib/subscription/types"
import { TokenBalanceResolver } from "@/lib/tokens/TokenBalanceResolver"
import {
  TokenSpendRuleNotFoundError,
  TokenSpendService,
  type TokenSpendPreview,
} from "@/lib/tokens/TokenSpendService"

export const dynamic = "force-dynamic"

type RulePreviewResult = {
  ruleCode: string
  preview: TokenSpendPreview | null
  error: string | null
}

const RULE_CODE_PATTERN = /^[a-z0-9_:-]{3,96}$/i

function parseRuleCodes(url: URL): string[] {
  const direct = url.searchParams
    .getAll("ruleCode")
    .flatMap((entry) => String(entry ?? "").split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && RULE_CODE_PATTERN.test(value))

  return Array.from(new Set(direct)).slice(0, 8)
}

export async function GET(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as {
      user?: { id?: string; email?: string | null }
    } | null
    const userId = session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const url = new URL(req.url)
    const rawFeature = String(url.searchParams?.get("feature") ?? "").trim()
    if (rawFeature && !isSubscriptionFeatureId(rawFeature)) {
      return NextResponse.json({ error: "Invalid feature id" }, { status: 400 })
    }

    const featureId = (rawFeature || null) as SubscriptionFeatureId | null
    const ruleCodes = parseRuleCodes(url)

    const entitlementResolver = new EntitlementResolver()
    const tokenBalanceResolver = new TokenBalanceResolver()
    const tokenSpendService = new TokenSpendService()

    // Both resolvers are allowed to reject here -- a real backend/DB failure must fail the whole
    // request (caught by the outer try/catch below, returning a genuine 500), the same contract
    // /api/tokens/balance and /api/subscription/entitlements already use. Swallowing either
    // failure into a fabricated { plans: [], status: "none" } / { balance: 0 } response would be
    // indistinguishable from a real verified free/zero-balance account -- exactly what this PR
    // exists to eliminate. Token-rule previews below are a different case: each is independently
    // optional, so a single bad rule code degrading to a per-item error is the correct behavior,
    // not a whole-request failure.
    const [entitlementResult, tokenBalance] = await Promise.all([
      entitlementResolver.resolveForUser(userId, featureId ?? undefined, session?.user?.email),
      tokenBalanceResolver.resolveForUser(userId, session?.user?.email),
    ])

    const rulePreviews = await Promise.all(
      ruleCodes.map(async (ruleCode): Promise<RulePreviewResult> => {
        try {
          const preview = await tokenSpendService.previewSpendWithEntitlement({
            userId,
            ruleCode,
            entitlement: entitlementResult.entitlement,
            currentBalance: Number(tokenBalance.balance || 0),
            userEmail: session?.user?.email,
          })
          return { ruleCode, preview, error: null }
        } catch (error) {
          if (error instanceof TokenSpendRuleNotFoundError) {
            console.error("[monetization/context GET] unknown token spend rule", ruleCode)
            return { ruleCode, preview: null, error: error.message }
          }
          console.error(
            `[monetization/context GET] preview fallback for ${ruleCode}`,
            error instanceof Error ? error.message : error
          )
          return { ruleCode, preview: null, error: "Unable to preview token cost right now." }
        }
      })
    )
    const bundleInheritance = resolveBundleInheritance(entitlementResult.entitlement.plans)
    const requiredPlanId = featureId ? getRequiredPlanForFeature(featureId) : null
    const requiredPlan = requiredPlanId ? getDisplayPlanName(requiredPlanId) : null

    return NextResponse.json({
      entitlement: entitlementResult.entitlement,
      bundleInheritance,
      entitlementMessage: entitlementResult.message,
      feature: featureId
        ? {
            featureId,
            hasAccess: Boolean(entitlementResult.hasAccess),
            requiredPlan,
            upgradePath: buildFeatureUpgradePath(featureId),
            message: entitlementResult.message,
          }
        : null,
      tokenBalance: {
        balance: Number(tokenBalance.balance ?? 0),
        lifetimePurchased: Number(tokenBalance.lifetimePurchased ?? 0),
        lifetimeSpent: Number(tokenBalance.lifetimeSpent ?? 0),
        lifetimeRefunded: Number(tokenBalance.lifetimeRefunded ?? 0),
        updatedAt: String(tokenBalance.updatedAt ?? ""),
      },
      tokenPreviews: rulePreviews,
    })
  } catch (error) {
    console.error("[monetization/context GET]", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "Failed to load monetization context" }, { status: 500 })
  }
}


