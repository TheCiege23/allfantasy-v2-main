import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import { resolveBundleInheritance } from "@/lib/subscription/feature-access"
import { syncUserProfileFromSubscriptions } from "@/lib/subscription/syncBridge"
import { TokenBalanceResolver } from "@/lib/tokens/TokenBalanceResolver"
import {
  getMonetizationCatalogItemBySku,
  type MonetizationSku,
} from "@/lib/monetization/catalog"
import { buildSubscriptionPurchaseMetaEvent } from "@/lib/monetization/meta"
import { ACCOUNT_CARD_PAID_BLOCK, ACCOUNT_FULL_BLOCK } from "@/lib/geo/accountGeoLock"
import { readAccountGeoLockFresh } from "@/lib/geo/accountGeoLockServer"
import { CARD_PAID_LOCK_MESSAGE } from "@/lib/geo/cardLockCopy"

export const dynamic = "force-dynamic"

/**
 * "refused": the payment was refunded because the card's billing address was in
 * a restricted state (lib/subscription/paidStateRefusal). Without it the buyer
 * would sit on "still finalizing" forever, for a purchase that is never coming.
 */
type SyncStatus = "synced" | "pending" | "no_session" | "refused"

function normalizeSessionId(raw: string | null): string | null {
  if (!raw) return null
  const value = raw.trim()
  if (!value) return null
  if (value.length > 128) return value.slice(0, 128)
  return value
}

export async function GET(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = session.user.id
    const url = new URL(req.url)
    const sessionId = normalizeSessionId(
      url.searchParams?.get("session_id") ?? url.searchParams?.get("sessionId")
    )

    const [entitlementResult, tokenBalance, subscriptionHit, tokenLedgerHit] =
      await Promise.all([
        new EntitlementResolver().resolveForUser(userId),
        new TokenBalanceResolver().resolveForUser(userId),
        sessionId
          ? (prisma as any).userSubscription
              .findFirst({
                where: { userId, stripeCheckoutSessionId: sessionId },
                select: { id: true, sku: true },
              })
              .catch(() => null)
          : Promise.resolve(null),
        sessionId
          ? (prisma as any).tokenLedger
              .findFirst({
                where: {
                  userId,
                  sourceType: "stripe_checkout",
                  sourceId: sessionId,
                  entryType: "purchase",
                },
                select: { id: true },
              })
              .catch(() => null)
          : Promise.resolve(null),
      ])

    await syncUserProfileFromSubscriptions(userId).catch(() => null)

    let syncStatus: SyncStatus = !sessionId
      ? "no_session"
      : subscriptionHit || tokenLedgerHit
        ? "synced"
        : "pending"
    // Only a purchase that has not landed can have been refused; a failed read stays "pending".
    // A Washington card sets the FULL lock rather than the card lock, so both mean refused here.
    if (syncStatus === "pending") {
      const lock = await readAccountGeoLockFresh(userId)
      if (lock === ACCOUNT_CARD_PAID_BLOCK || lock === ACCOUNT_FULL_BLOCK) syncStatus = "refused"
    }

    const syncMessage =
      syncStatus === "synced"
        ? "Purchase processed. Access state refreshed."
        : syncStatus === "refused"
          ? CARD_PAID_LOCK_MESSAGE
          : syncStatus === "pending"
            ? "Purchase is still finalizing. Retry shortly."
            : "No checkout session id provided. Refreshed current state."

    const subscriptionItem =
      subscriptionHit?.sku
        ? getMonetizationCatalogItemBySku(subscriptionHit.sku as MonetizationSku)
        : null
    const purchaseMetaEvent =
      sessionId && subscriptionItem?.type === "subscription"
        ? buildSubscriptionPurchaseMetaEvent(subscriptionItem, sessionId)
        : null

    return NextResponse.json({
      syncStatus,
      syncMessage,
      sessionId,
      syncEvidence: {
        subscription: Boolean(subscriptionHit),
        tokens: Boolean(tokenLedgerHit),
      },
      metaEvents: purchaseMetaEvent ? { purchase: purchaseMetaEvent } : {},
      entitlement: entitlementResult.entitlement,
      bundleInheritance: resolveBundleInheritance(entitlementResult.entitlement.plans),
      tokenBalance: {
        balance: Number(tokenBalance.balance ?? 0),
        lifetimePurchased: Number(tokenBalance.lifetimePurchased ?? 0),
        lifetimeSpent: Number(tokenBalance.lifetimeSpent ?? 0),
        lifetimeRefunded: Number(tokenBalance.lifetimeRefunded ?? 0),
        updatedAt: String(tokenBalance.updatedAt ?? ""),
      },
      resolvedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error("[monetization/post-purchase-sync GET]", error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: "Failed to sync post-purchase state." },
      { status: 500 }
    )
  }
}

