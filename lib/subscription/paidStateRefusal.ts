/**
 * The paid-state card check: a purchase whose card BILLING ADDRESS is in a
 * restricted state is refused — nothing granted, the payment refunded in full,
 * the subscription cancelled, and the account locked out of paid checkout.
 *
 * Owner's decision, 2026-09-24: paid-feature states (HI, ID, MT, NV — and
 * Washington, which is stricter still) are gated by the card's billing address.
 * The IP gates already refuse checkout from those states; this catches the buyer
 * whose IP says somewhere else — an uncatalogued residential proxy — because the
 * address their bank holds is not something the proxy can rewrite.
 *
 * ⚠ AFTER THE CHARGE, NOT BEFORE, AND THAT IS A KNOWN COST. Hosted Checkout has
 * no hook between "card entered" and "card charged". Refusing BEFORE the charge
 * needs either a Stripe Radar custom rule (Radar Plus, account-wide — and the
 * account is shared with other businesses) or a rebuilt checkout; both are the
 * owner's call. Until then a refused buyer sees a charge and a full refund, and
 * the lock makes that happen at most once per account.
 *
 * ⚠ LOCK FIRST, THEN STOP BILLING, THEN REFUND. Every step is idempotent and a
 * failure THROWS, so the webhook marks the event errored and Stripe retries the
 * whole sequence. The lock goes first so that no retry window lets the account
 * start a second checkout.
 *
 * ⚠ The address and ZIP are never logged — only the state they resolved to.
 */
import type Stripe from "stripe"

import { restrictedBillingState, type RestrictedBillingState } from "@/lib/geo/billingAddressState"

export interface PaidStateRefusal extends RestrictedBillingState {
  canceledSubscriptionId: string | null
  refundedPaymentIntentId: string | null
  refundedChargeId: string | null
}

export interface PaidStateRefusalDeps {
  stripe: Stripe
  /** Lock the account out of paid features (lib/geo/accountGeoLockServer). */
  lockAccount(userId: string): Promise<void>
}

function idOf(ref: unknown): string | null {
  if (typeof ref === "string") return ref || null
  if (ref && typeof ref === "object" && typeof (ref as { id?: unknown }).id === "string") return (ref as { id: string }).id
  return null
}

/** The restricted state this checkout's billing address is in, or null. */
export function restrictedBillingStateOfCheckout(
  session: Pick<Stripe.Checkout.Session, "customer_details">,
): RestrictedBillingState | null {
  return restrictedBillingState(session.customer_details?.address ?? null)
}

/**
 * What to refund for this checkout: its payment intent, or — for an invoice paid
 * by a bare charge — that charge. Null when nothing was paid (a 100%-off code).
 *
 * A one-time purchase names its payment intent directly. A subscription's first
 * payment belongs to its first invoice, and on the live endpoint's API version
 * (2025-05-28.basil) an invoice no longer names its payment intent, so the
 * invoice's payments are listed instead.
 */
async function paymentOfCheckout(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<{ paymentIntentId: string | null; chargeId: string | null }> {
  const none = { paymentIntentId: null, chargeId: null }
  if (session.amount_total === 0) return none

  const direct = idOf(session.payment_intent)
  if (direct) return { paymentIntentId: direct, chargeId: null }

  const invoiceId = idOf(session.invoice)
  if (!invoiceId) return none
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 })
  const paid = payments.data.find((p) => p.status === "paid") ?? payments.data[0]
  if (!paid) return none
  return { paymentIntentId: idOf(paid.payment?.payment_intent), chargeId: idOf(paid.payment?.charge) }
}

async function cancelIfLive(stripe: Stripe, subscriptionId: string): Promise<void> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId).catch((error: { code?: string }) => {
    if (error?.code === "resource_missing") return null
    throw error
  })
  if (sub && sub.status !== "canceled" && sub.status !== "incomplete_expired") {
    await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false })
  }
}

async function refundInFull(
  stripe: Stripe,
  sessionId: string,
  target: { paymentIntentId: string | null; chargeId: string | null },
  stateCode: string,
): Promise<void> {
  if (!target.paymentIntentId && !target.chargeId) return
  try {
    await stripe.refunds.create(
      {
        ...(target.paymentIntentId ? { payment_intent: target.paymentIntentId } : { charge: target.chargeId! }),
        metadata: { af_reason: "paid_state_billing_address", af_state: stateCode, af_checkout_session: sessionId },
      },
      // Stripe keeps an idempotency key for 24h; past that, a second attempt meets
      // `charge_already_refunded`, handled below.
      { idempotencyKey: `af-paid-state-refund-${sessionId}` },
    )
  } catch (error) {
    if ((error as { code?: string })?.code === "charge_already_refunded") return
    throw error
  }
}

/**
 * Refuse this checkout if its billing address is in a restricted state.
 * Returns what was done, or null when the address is fine (or unknown).
 */
export async function refuseCheckoutForRestrictedBillingState(
  session: Stripe.Checkout.Session,
  userId: string | null,
  deps: PaidStateRefusalDeps,
): Promise<PaidStateRefusal | null> {
  const verdict = restrictedBillingStateOfCheckout(session)
  if (!verdict) return null

  // 1. The account cannot start another checkout.
  if (userId) await deps.lockAccount(userId)

  // 2. Nothing is billed again.
  const canceledSubscriptionId = idOf(session.subscription)
  if (canceledSubscriptionId) await cancelIfLive(deps.stripe, canceledSubscriptionId)

  // 3. What was paid goes back, in full.
  const payment = await paymentOfCheckout(deps.stripe, session)
  await refundInFull(deps.stripe, session.id, payment, verdict.stateCode)

  console.warn(
    `[geo] purchase refused: card billing address in ${verdict.stateCode} (by ${verdict.source}); ` +
      `checkout ${session.id}, user ${userId ?? "unknown"} — refunded and locked.`,
  )

  return {
    ...verdict,
    canceledSubscriptionId,
    refundedPaymentIntentId: payment.paymentIntentId,
    refundedChargeId: payment.chargeId,
  }
}
