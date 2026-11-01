import "server-only"
import { prisma } from "@/lib/prisma"
import { decryptPurchaseToken, PlayBillingError } from "./billingConfig"
import { googlePlayPublisher } from "./billingPublisher"
import { parsePlayPurchase } from "./billingState"

/** Called before erasing an account. Any provider failure prevents deletion. No refund is issued. */
export async function cancelGooglePlayOnDelete(userId: string, publisher: Pick<typeof googlePlayPublisher, "get" | "cancel"> = googlePlayPublisher) {
  const rows = await prisma.googlePlayPurchase.findMany({ where: { ownerId: userId, purchaseType: "subscription" } })
  const cancelled: string[] = []
  for (const row of rows) {
    // Terminal periods are never billable, and Google may no longer retain these old tokens.
    if (["SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"].includes(row.state)) continue
    const token = decryptPurchaseToken(row.tokenCiphertext)
    const state = parsePlayPurchase("subscription", await publisher.get("subscription", token), row.productId)
    if (state.status === "pending") throw new PlayBillingError("Cancel your pending Google Play payment before deleting your account.", 409)
    if (state.status === "canceled" || state.state === "SUBSCRIPTION_STATE_EXPIRED" || state.state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") continue
    await publisher.cancel(token)
    await prisma.googlePlayPurchase.update({ where: { tokenHash: row.tokenHash }, data: { state: "SUBSCRIPTION_STATE_CANCELED" } })
    await prisma.userSubscription.updateMany({ where: { userId, source: "google_play", id: `google_play:${row.tokenHash}` }, data: { status: "canceled", canceledAt: new Date() } })
    cancelled.push(`google_play:${row.tokenHash}`)
  }
  return cancelled
}
