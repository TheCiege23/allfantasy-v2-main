import "server-only"
import { prisma } from "@/lib/prisma"
import {
  getMonetizationCatalogItemBySku,
  type MonetizationSku,
  type SubscriptionPlanFamily,
} from "@/lib/monetization/catalog"
import { resolveSubscriptionStatus } from "@/lib/subscription/SubscriptionStatusResolver"

/**
 * The Stripe customer this user already has, if any.
 *
 * ⚠ Checkout used to pass only `customer_email`, so EVERY subscription checkout
 * minted a new Stripe Customer. A user holding two plans then had two customers,
 * and "Manage billing" (which opens the most recently updated one) could reach only
 * one of them — the other plan could not be cancelled from the app at all.
 * Passing the existing id keeps one customer per user from the second purchase on.
 */
export async function findStripeCustomerIdForUser(userId: string): Promise<string | null> {
  const row = await prisma.userSubscription.findFirst({
    where: { userId, stripeCustomerId: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { stripeCustomerId: true },
  })
  return row?.stripeCustomerId ?? null
}

/**
 * Plan families the user is currently being billed for through Stripe — the rows
 * whose status still resolves to access (active, grace or past_due), read through
 * the same resolver the entitlement check uses so the two cannot disagree.
 */
export async function findLiveStripePlanFamiliesForUser(
  userId: string
): Promise<Set<SubscriptionPlanFamily>> {
  const rows = await prisma.userSubscription.findMany({
    where: { userId, source: "stripe" },
    select: {
      sku: true,
      status: true,
      currentPeriodEnd: true,
      gracePeriodEnd: true,
      expiresAt: true,
    },
  })
  const families = new Set<SubscriptionPlanFamily>()
  for (const row of rows) {
    const status = resolveSubscriptionStatus(row)
    if (status !== "active" && status !== "grace" && status !== "past_due") continue
    const item = row.sku ? getMonetizationCatalogItemBySku(row.sku as MonetizationSku) : null
    if (item?.planFamily) families.add(item.planFamily)
  }
  return families
}

/** Plan families AF Supreme includes — `SUPREME_INCLUDED_PLAN_IDS` (pro, commissioner, war_room since 2026-11-27). */
const SUPREME_INCLUDES: ReadonlySet<SubscriptionPlanFamily> = new Set(["af_pro", "af_commissioner", "af_war_room"])

/**
 * Why buying `planFamily` would double-bill, or null when it would not.
 *
 * An exact repeat is refused, and so is Pro, Commissioner or Legacy on top of Supreme, which includes them.
 *
 * 🛑 AF LEGACY IS IN SUPREME AGAIN (owner's decision 2026-11-27 — `SUPREME_INCLUDED_PLAN_IDS`). From
 * 2026-10-25 it was not, and a Supreme member could buy Legacy on top; now that would double-bill for a
 * plan Supreme already opens, so it is refused like Pro and Commissioner.
 *
 * Supreme on top of Pro, Commissioner or Legacy is not a duplicate: it is a switch, done in place by
 * `lib/monetization/supremeSwitch.ts` — one subscription, prorated — never a second checkout.
 */
export function duplicatePlanReason(
  livePlanFamilies: Set<SubscriptionPlanFamily>,
  planFamily: SubscriptionPlanFamily
): "same_plan" | "has_supreme" | null {
  if (livePlanFamilies.has(planFamily)) return "same_plan"
  if (livePlanFamilies.has("af_supreme") && SUPREME_INCLUDES.has(planFamily)) return "has_supreme"
  return null
}
