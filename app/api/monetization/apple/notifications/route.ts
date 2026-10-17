import { NextResponse } from "next/server"
import { getMonetizationCatalogItemBySku, type MonetizationSku } from "@/lib/monetization/catalog"
import { ApplePurchaseError, applyApplePurchase, expireAppleSubscription } from "@/lib/monetization/applePurchases"
import { appleIapConfigured, getCurrentAppleTransaction, verifyAppleNotification, verifyAppleTransaction } from "@/lib/monetization/appleStore"
import { TokenSpendService } from "@/lib/tokens/TokenSpendService"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!appleIapConfigured()) {
    return NextResponse.json({ error: "Apple purchases are not configured" }, { status: 503 })
  }
  let body: { signedPayload?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (typeof body.signedPayload !== "string" || body.signedPayload.length > 100_000) {
    return NextResponse.json({ error: "Missing Apple signed payload" }, { status: 400 })
  }
  try {
    const { payload, environment } = await verifyAppleNotification(body.signedPayload)
    const signedTransaction = payload.data?.signedTransactionInfo
    if (!signedTransaction) return NextResponse.json({ ok: true }) // TEST or summary notification
    const transaction = await verifyAppleTransaction(signedTransaction)
    const item = getMonetizationCatalogItemBySku(transaction.productId as MonetizationSku)
    if (!item || !transaction.transactionId) return NextResponse.json({ ok: true })

    switch (payload.notificationType) {
      case "ONE_TIME_CHARGE":
        if (item.type === "token_pack" && transaction.appAccountToken) {
          const current = await getCurrentAppleTransaction(transaction.transactionId, environment)
          if (!current.revocationDate) {
            await applyApplePurchase(current, transaction.appAccountToken)
          }
        }
        break
      case "SUBSCRIBED":
      case "DID_RENEW":
      case "DID_RECOVER":
      case "DID_CHANGE_RENEWAL_PREF":
      case "OFFER_REDEEMED":
      case "RENEWAL_EXTENDED":
        if (item.type === "subscription" && transaction.appAccountToken) {
          // A delayed renewal notification cannot revive a subsequently refunded period.
          const current = await getCurrentAppleTransaction(transaction.transactionId, environment)
          if (current.revocationDate) {
            await expireAppleSubscription(current, "expired")
          } else if (current.expiresDate && current.expiresDate > Date.now()) {
            await applyApplePurchase(current, current.appAccountToken || transaction.appAccountToken)
          }
        }
        break
      case "EXPIRED":
      case "GRACE_PERIOD_EXPIRED":
        if (item.type === "subscription") await expireAppleSubscription(transaction, "expired")
        break
      case "REFUND":
      case "REVOKE":
        if (item.type === "subscription") {
          await expireAppleSubscription(transaction, "expired")
        } else {
          await new TokenSpendService().reverseApplePackagePurchase(transaction.transactionId)
        }
        break
      default:
        // A cancellation turns off future renewals; access remains until the paid period ends.
        break
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ApplePurchaseError && error.status < 500) {
      console.error("[apple/notifications] Cannot apply verified notification", error)
    } else {
      console.error("[apple/notifications] Notification processing failed", error)
    }
    // Apple retries non-2xx notifications. Never acknowledge an unprocessed refund or renewal.
    return NextResponse.json({ error: "Apple notification processing failed" }, { status: 503 })
  }
}
