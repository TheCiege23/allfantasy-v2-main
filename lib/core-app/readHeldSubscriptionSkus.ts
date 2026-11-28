import { prisma } from "@/lib/prisma"
import { resolveSubscriptionStatus } from "@/lib/subscription/SubscriptionStatusResolver"
import { isActiveOrGraceStatus } from "@/lib/subscription/feature-access"

/**
 * The SKUs (e.g. `af_pro_monthly`) of the viewer's live subscriptions, from any store — Stripe,
 * Apple or Google Play. /pricing uses it to mark the exact plan + interval a viewer already pays for
 * as "Current plan" instead of offering it again. Same liveness rule as EntitlementResolver (active
 * or in grace). A failed read is `[]`: the page then just shows the buy buttons, as before.
 */
export async function readHeldSubscriptionSkus(userId: string, now = new Date()): Promise<string[]> {
  try {
    const rows = await prisma.userSubscription.findMany({
      where: { userId },
      select: { sku: true, status: true, currentPeriodEnd: true, gracePeriodEnd: true, expiresAt: true },
    })
    const skus = new Set<string>()
    for (const row of rows) {
      if (!row.sku) continue
      const status = resolveSubscriptionStatus(
        {
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd ?? null,
          gracePeriodEnd: row.gracePeriodEnd ?? null,
          expiresAt: row.expiresAt ?? null,
        },
        now
      )
      if (isActiveOrGraceStatus(status)) skus.add(row.sku)
    }
    return Array.from(skus)
  } catch {
    return []
  }
}
