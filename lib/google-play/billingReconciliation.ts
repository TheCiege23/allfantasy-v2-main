import "server-only"
import { prisma } from "@/lib/prisma"
import { playServerConfigured, purchaseHash } from "./billingConfig"
import { publisherRequest } from "./billingPublisher"
import { refreshStoredGooglePlayPurchase, reverseVoidedPlayPack } from "./billingPurchases"

export async function reconcileGooglePlayBilling(budgetMs = 60_000) {
  if (!playServerConfigured()) return { skipped: true, refreshed: 0, voids: 0, failures: 0 }
  const deadline = Date.now() + Math.max(0, budgetMs)
  const checkBudget = () => { if (Date.now() >= deadline) throw new Error("Play billing reconciliation budget reached") }
  let refreshed = 0, failures = 0, voids = 0, pageToken: string | undefined
  // Re-read the last 30 days on every run, including overlap. Reversals are durable and idempotent.
  // Bounded pagination fails visibly rather than silently dropping a page.
  for (let page = 0; page < 10; page++) {
    checkBudget()
    const params = new URLSearchParams({ type: "1", maxResults: "100", startTime: String(Date.now() - 29 * 86400_000), includeQuantityBasedPartialRefund: "true" })
    if (pageToken) params.set("token", pageToken)
    const result = await publisherRequest(`purchases/voidedpurchases?${params}`) as { voidedPurchases?: Array<{ purchaseToken?: string; orderId?: string }>; tokenPagination?: { nextPageToken?: string } }
    for (const row of result.voidedPurchases ?? []) {
      checkBudget()
      if (!row.purchaseToken) { failures++; continue }
      const stored = await prisma.googlePlayPurchase.findUnique({ where: { tokenHash: purchaseHash(row.purchaseToken) } })
      if (!stored) continue // Initial verification still reads authoritative current state.
      if (stored.purchaseType === "subscription") {
        try { await refreshStoredGooglePlayPurchase(stored.tokenHash); voids++ } catch { failures++ }
      } else {
        try { await reverseVoidedPlayPack(row.purchaseToken); voids++ } catch { failures++ }
      }
    }
    pageToken = result.tokenPagination?.nextPageToken
    if (!pageToken) break
  }
  if (pageToken) failures++
  const rows = await prisma.googlePlayPurchase.findMany({ where: { ownerId: { not: null },
    OR: [{ purchaseType: "subscription", state: { notIn: ["SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"] } },
      { finalizedAt: null, revokedAt: null }] }, orderBy: { lastCheckedAt: "asc" }, take: 25, select: { tokenHash: true } })
  for (const row of rows) {
    checkBudget()
    try { const result = await refreshStoredGooglePlayPurchase(row.tokenHash); refreshed++; if (result?.finishPending) failures++ } catch { failures++ }
  }
  await prisma.googlePlayCheckoutIntent.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 30 * 86400_000) } } })
  return { refreshed, voids, failures }
}
