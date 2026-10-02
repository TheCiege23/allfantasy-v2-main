import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { cancelSubscriptionsOnDelete } from "@/lib/account/cancelSubscriptionsOnDelete"
import { getStripeClient } from "@/lib/stripe-client"

export const dynamic = "force-dynamic"

/**
 * POST /api/account/cancel-subscription — the "Cancel my subscription" button on /paid-restricted.
 *
 * Owner's call, 2026-10-02. A subscriber who is located in a paid-restricted state could not cancel:
 * the billing portal route refuses those states (its geo check), so they reached /paid-restricted
 * with no way to stop being charged. This cancels on our side instead of opening the Stripe portal,
 * whose plan-change options would themselves be a purchase from a restricted state.
 *
 * ⚠ NO GEO CHECK, ON PURPOSE, and middleware exempts this path from the VPN and account-lock gates
 * (CANCEL_SUBSCRIPTION_API): stopping a charge must never depend on where someone is. It only ever
 * REMOVES billing. Requires a session and an explicit `{ confirm: true }`, like account deletion.
 *
 * Immediate, no proration, no refund — the same terms and the same code as deleting the account
 * (lib/account/cancelSubscriptionsOnDelete). App Store subscriptions cannot be cancelled by us; the
 * response says so and the page tells the user where to do it.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Sign in to cancel your subscription." }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: "Cancelling requires explicit confirmation.", code: "confirmation_required" },
      { status: 400 },
    )
  }

  try {
    const result = await cancelSubscriptionsOnDelete(
      userId,
      {
        findSubscriptions: (id) =>
          prisma.userSubscription.findMany({
            where: { userId: id },
            select: { stripeSubscriptionId: true, stripeCustomerId: true, source: true, status: true },
          }),
        getStripe: getStripeClient,
      },
      { comment: "Cancelled by the subscriber from /paid-restricted (paid features unavailable in their state)" },
    )
    console.warn("[account/cancel-subscription] cancelled", { userId, count: result.cancelled.length })
    return NextResponse.json({
      ok: true,
      cancelledSubscriptions: result.cancelled.length,
      appleSubscriptionActive: result.hasAppleSubscription,
    })
  } catch (error) {
    console.error("[account/cancel-subscription] failed:", error instanceof Error ? error.message : error)
    return NextResponse.json(
      {
        error: "We couldn't cancel your subscription just now. Please try again, or contact support and we'll cancel it for you.",
        code: "subscription_cancel_failed",
      },
      { status: 502 },
    )
  }
}
