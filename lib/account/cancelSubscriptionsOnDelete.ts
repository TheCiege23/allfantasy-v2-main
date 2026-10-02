import type Stripe from "stripe"

/**
 * Cancel every live Stripe subscription an account holds, BEFORE the account is erased.
 *
 * 🛑 `/api/user/delete` used to anonymize the account and never call Stripe, so a subscriber who
 * deleted their account kept being charged — for an account that no longer existed, with no login
 * left to reach the billing portal from. Owner's call, 2026-10-02: deletion cancels the subscription.
 *
 * Two sources, unioned, because either alone can miss one:
 *  - our `UserSubscription` rows that carry a `stripeSubscriptionId`;
 *  - Stripe's own list for every customer id those rows name — a subscription created outside the
 *    checkout path, or whose row the webhook never wrote, still bills the customer.
 *
 * Cancellation is immediate, with no proration and no refund — the same terms as
 * lib/subscription/paidStateRefusal.ts. Anything already cancelled (or never started) is skipped,
 * so a retry after a partial failure is safe. Any Stripe error THROWS: the caller must not erase
 * the account while it may still be billed.
 *
 * App Store subscriptions (`source: "apple"`) cannot be cancelled by us — Apple only lets the user
 * do that — so they are reported back, not touched.
 */

/** Stripe statuses that can still produce a charge. */
const BILLABLE: ReadonlySet<Stripe.Subscription.Status> = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
])

type SubscriptionRow = {
  stripeSubscriptionId: string | null
  stripeCustomerId: string | null
  source: string
  status: string
}

export type CancelSubscriptionsDeps = {
  findSubscriptions: (userId: string) => Promise<SubscriptionRow[]>
  /** Called only when there is something to look up, so an account with no Stripe history needs no key. */
  getStripe: () => Stripe
}

export type CancelSubscriptionsResult = {
  /** Stripe subscription ids this call cancelled. */
  cancelled: string[]
  /** True when the account has an App Store subscription we cannot cancel. */
  hasAppleSubscription: boolean
}

export async function cancelSubscriptionsOnDelete(
  userId: string,
  deps: CancelSubscriptionsDeps,
): Promise<CancelSubscriptionsResult> {
  const rows = await deps.findSubscriptions(userId)

  const hasAppleSubscription = rows.some(
    (r) => r.source === "apple" && r.status !== "canceled" && r.status !== "expired",
  )

  const subscriptionIds = new Set(rows.map((r) => r.stripeSubscriptionId).filter((id): id is string => !!id))
  const customerIds = new Set(rows.map((r) => r.stripeCustomerId).filter((id): id is string => !!id))
  if (subscriptionIds.size === 0 && customerIds.size === 0) {
    return { cancelled: [], hasAppleSubscription }
  }

  const stripe = deps.getStripe()

  // Stripe's default list omits only `canceled`, so this sees trialing / past_due / unpaid too.
  for (const customer of customerIds) {
    for await (const sub of stripe.subscriptions.list({ customer, limit: 100 })) {
      subscriptionIds.add(sub.id)
    }
  }

  const cancelled: string[] = []
  for (const id of subscriptionIds) {
    const sub = await stripe.subscriptions.retrieve(id).catch((error: { code?: string }) => {
      // A row naming a subscription Stripe no longer has bills nothing.
      if (error?.code === "resource_missing") return null
      throw error
    })
    if (!sub || !BILLABLE.has(sub.status)) continue
    await stripe.subscriptions.cancel(id, {
      invoice_now: false,
      prorate: false,
      cancellation_details: { comment: "AllFantasy account deleted by its owner" },
    })
    cancelled.push(id)
  }

  return { cancelled, hasAppleSubscription }
}
