import "server-only"
import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import {
  getMonetizationCatalogItemBySku,
  getMonetizationStripePriceIdForSku,
  type MonetizationSku,
  type SubscriptionPlanFamily,
} from "@/lib/monetization/catalog"
import { resolveSubscriptionStatus } from "@/lib/subscription/SubscriptionStatusResolver"
import { upsertSubscriptionPlanForCatalogItem } from "@/lib/subscription/webhookHandlers"

/**
 * Pro / Commissioner → Supreme as ONE subscription, prorated (owner's decision, 2026-11-16).
 *
 * 🛑 BEFORE THIS, AN UPGRADE BILLED TWICE. The Supreme spotlight's "Switch from AF Pro" link opened a
 * brand-new Supreme checkout; `duplicatePlanReason` allowed it (a different plan), and nothing cancelled
 * the Pro subscription — its own comment said "buying Supreme and then cancelling Pro is the only upgrade
 * path". So a member paid $9.99 + $19.99 until they found Settings → Billing themselves.
 *
 * Now a Stripe member holding Pro or Commissioner who buys Supreme never sees Checkout:
 *   - the subscription they already pay for is SWITCHED to the Supreme price, charging only the
 *     difference for the rest of the period, now (`always_invoice`). Payment must succeed
 *     (`error_if_incomplete`), so a declined card changes nothing;
 *   - a Pro trial switching to Supreme ends the trial (`trial_end: 'now'`): the trial was for Pro;
 *   - holding BOTH Pro and Commissioner, the other subscription is cancelled with a prorated credit —
 *     Supreme includes both.
 * The rows are updated here too, so access is immediate; the webhook's `customer.subscription.updated`
 * (`updateSubscriptionFromStripeEvent`, which follows a price change) agrees with them when it lands.
 *
 * Apple and Google Play subscriptions are never touched: they cannot be switched from the web.
 */

/**
 * Plan families Supreme includes (`SUPREME_INCLUDED_PLAN_IDS`: pro, commissioner and — since 2026-11-27 —
 * war_room, AF Legacy). A Legacy subscriber buying Supreme is switched in place like a Pro one; holding
 * Legacy beside another, the extra subscription is cancelled with a prorated credit, because Supreme now
 * includes it.
 */
export const SUPREME_BUNDLED_FAMILIES: ReadonlySet<SubscriptionPlanFamily> = new Set(["af_pro", "af_commissioner", "af_war_room"])

/** Most expensive first: the one switched is the one whose price is closest to Supreme's. */
const SWITCH_ORDER: readonly SubscriptionPlanFamily[] = ["af_commissioner", "af_pro", "af_war_room"]

export type SwitchSourceRow = {
  id: string
  stripeSubscriptionId: string
  sku: MonetizationSku
  family: SubscriptionPlanFamily
}

export type SupremeSwitchResult =
  | { kind: "not_applicable" }
  | { kind: "switched"; stripeSubscriptionId: string; fromSku: MonetizationSku; cancelledSubscriptionIds: string[] }
  | { kind: "failed"; status: number; error: string; code: string }

/** The user's live Stripe subscriptions Supreme would replace, most expensive first. Pure. */
export function pickSwitchSources(
  rows: ReadonlyArray<{ id: string; stripeSubscriptionId: string | null; sku: string | null; live: boolean }>,
): SwitchSourceRow[] {
  const out: SwitchSourceRow[] = []
  for (const r of rows) {
    if (!r.live || !r.stripeSubscriptionId || !r.sku) continue
    const item = getMonetizationCatalogItemBySku(r.sku as MonetizationSku)
    if (!item?.planFamily || !SUPREME_BUNDLED_FAMILIES.has(item.planFamily)) continue
    out.push({ id: r.id, stripeSubscriptionId: r.stripeSubscriptionId, sku: item.sku, family: item.planFamily })
  }
  return out.sort((a, b) => SWITCH_ORDER.indexOf(a.family) - SWITCH_ORDER.indexOf(b.family))
}

async function readSwitchSources(userId: string): Promise<SwitchSourceRow[]> {
  const rows = await prisma.userSubscription.findMany({
    where: { userId, source: "stripe", stripeSubscriptionId: { not: null } },
    select: { id: true, stripeSubscriptionId: true, sku: true, status: true, currentPeriodEnd: true, gracePeriodEnd: true, expiresAt: true },
  })
  return pickSwitchSources(
    rows.map((r) => {
      const status = resolveSubscriptionStatus(r)
      return { id: r.id, stripeSubscriptionId: r.stripeSubscriptionId, sku: r.sku, live: status === "active" || status === "grace" || status === "past_due" }
    }),
  )
}

function stripeErrorMessage(error: unknown): { status: number; error: string; code: string } {
  const e = error as { type?: string; code?: string; message?: string } | null
  if (e?.type === "StripeCardError" || e?.code === "card_declined") {
    return { status: 402, code: "payment_failed", error: "Your card was declined, so the switch to AF Supreme did not go through. Nothing changed." }
  }
  return { status: 502, code: "switch_failed", error: "The switch to AF Supreme could not be completed just now. Nothing changed — please try again." }
}

export async function switchToSupreme(input: {
  userId: string
  supremeSku: MonetizationSku
  stripe: Pick<Stripe, "subscriptions">
  entrySource?: string | null
  env?: NodeJS.ProcessEnv
}): Promise<SupremeSwitchResult> {
  const target = getMonetizationCatalogItemBySku(input.supremeSku)
  if (!target || target.planFamily !== "af_supreme") return { kind: "not_applicable" }

  const sources = await readSwitchSources(input.userId)
  if (sources.length === 0) return { kind: "not_applicable" }

  const priceId = getMonetizationStripePriceIdForSku(input.supremeSku, input.env ?? process.env)
  if (!priceId) {
    return { kind: "failed", status: 503, code: "price_unavailable", error: "AF Supreme is temporarily unavailable. Please try again shortly." }
  }

  const [primary, ...others] = sources
  let switched: Stripe.Subscription
  try {
    const current = await input.stripe.subscriptions.retrieve(primary!.stripeSubscriptionId)
    const item = current.items?.data?.[0]
    if (!item) return { kind: "failed", status: 502, code: "switch_failed", error: "Your current plan could not be read from billing. Nothing changed — please try again." }
    switched = await input.stripe.subscriptions.update(primary!.stripeSubscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
      cancel_at_period_end: false,
      ...(current.status === "trialing" ? { trial_end: "now" as const } : {}),
      metadata: {
        ...(current.metadata ?? {}),
        sku: input.supremeSku,
        switchedFromSku: primary!.sku,
        ...(input.entrySource ? { entrySource: input.entrySource } : {}),
      },
    })
  } catch (error) {
    console.error("[supremeSwitch] subscription update failed:", error instanceof Error ? error.message : error)
    return { kind: "failed", ...stripeErrorMessage(error) }
  }

  // Supreme includes both: the other plan stops now, credited for its unused time.
  const cancelledSubscriptionIds: string[] = []
  for (const other of others) {
    try {
      await input.stripe.subscriptions.cancel(other.stripeSubscriptionId, { prorate: true, invoice_now: true })
      cancelledSubscriptionIds.push(other.stripeSubscriptionId)
    } catch (error) {
      // The switch stands; the leftover plan is still cancellable in Settings → Billing.
      console.error("[supremeSwitch] cancelling the bundled plan failed:", error instanceof Error ? error.message : error)
    }
  }

  // Immediate access: the rows say Supreme now; the webhook confirms the same when it lands.
  const plan = await upsertSubscriptionPlanForCatalogItem(target).catch(() => null)
  const now = new Date()
  await prisma.userSubscription
    .update({
      where: { id: primary!.id },
      data: {
        sku: target.sku,
        status: switched.status === "trialing" ? "trialing" : "active",
        ...(plan ? { subscriptionPlanId: plan.id } : {}),
        metadata: { lastStripeEvent: "supreme_switch", switchedFromSku: primary!.sku, switchedAt: now.toISOString() },
      },
    })
    .catch((error: unknown) => console.error("[supremeSwitch] row update failed:", error instanceof Error ? error.message : error))
  for (const other of others) {
    if (!cancelledSubscriptionIds.includes(other.stripeSubscriptionId)) continue
    await prisma.userSubscription
      .update({ where: { id: other.id }, data: { status: "canceled", canceledAt: now, expiresAt: now } })
      .catch((error: unknown) => console.error("[supremeSwitch] row cancel failed:", error instanceof Error ? error.message : error))
  }

  return { kind: "switched", stripeSubscriptionId: primary!.stripeSubscriptionId, fromSku: primary!.sku, cancelledSubscriptionIds }
}
