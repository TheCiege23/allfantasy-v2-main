import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

/**
 * Whether the signed-in visitor still has a live subscription — they get a way to cancel it here,
 * because the billing portal is refused where they are (owner's call, 2026-10-02). Used by both block
 * pages: /paid-restricted and /geo-blocked. Read from our rows, never by calling Stripe on a page
 * load. Fails closed to "nothing to show".
 */
export async function liveSubscriptions(): Promise<{ hasStripe: boolean; hasApple: boolean }> {
  const none = { hasStripe: false, hasApple: false }
  try {
    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    if (!userId) return none
    const rows = await prisma.userSubscription.findMany({
      where: { userId, status: { notIn: ["canceled", "expired"] } },
      select: { source: true, stripeSubscriptionId: true, stripeCustomerId: true },
    })
    return {
      hasStripe: rows.some((r) => r.source !== "apple" && Boolean(r.stripeSubscriptionId || r.stripeCustomerId)),
      hasApple: rows.some((r) => r.source === "apple"),
    }
  } catch {
    return none
  }
}
