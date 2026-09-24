import { beforeEach, describe, expect, it, vi } from "vitest"

/*
 * Billing correctness against the payload shape the LIVE webhook endpoint sends.
 *
 * The endpoint is pinned to API 2025-05-28.basil (measured 2026-09-24). Basil moved
 * the subscription period onto the items and the invoice's subscription id under
 * `parent`, and `invoice.period_end` looks BACK a period on a subscription invoice.
 * Every fixture below is built in that shape, and each period test asserts the
 * EFFECT — what `resolveSubscriptionStatus` makes of the written row — because the
 * bug was never a wrong field in isolation, it was a paying subscriber reading as
 * expired.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    userSubscription: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    subscriptionPlan: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/tokens/TokenSpendService", () => ({
  TokenSpendService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.grantMonthlySubscriptionCredits = vi.fn()
  }),
}))

import {
  invoiceServicePeriodEnd,
  invoiceSubscriptionId,
  markSubscriptionPastDue,
  refreshSubscriptionPeriod,
  resolveSubscriptionSkuFromStripe,
  subscriptionPeriods,
  updateSubscriptionFromStripeEvent,
} from "@/lib/subscription/webhookHandlers"
import { resolveSubscriptionStatus } from "@/lib/subscription/SubscriptionStatusResolver"
import { duplicatePlanReason } from "@/lib/monetization/stripeCustomerForUser"

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000)

/*
 * ⚠ NOT the instant the new period starts. At that instant the buggy value
 * (invoice.period_end == new period start) equals "now", and `>=` reads it as
 * active — a first draft of this test checked exactly there and PASSED with the
 * bug restored. Stripe pays a renewal invoice about an hour after the period
 * rolls over, so that is when the subscriber is looked at.
 */
const NOW = new Date("2026-11-15T13:00:00Z")
const NEW_PERIOD_START = "2026-11-15T12:00:00Z"
const NEW_PERIOD_END = "2026-12-15T12:00:00Z"
const OLD_PERIOD_START = "2026-10-15T12:00:00Z"

/** A basil renewal invoice: no top-level `subscription`, period_end looking back. */
function basilRenewalInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_renewal_1",
    customer: "cus_1",
    billing_reason: "subscription_cycle",
    period_start: sec(OLD_PERIOD_START),
    period_end: sec(NEW_PERIOD_START),
    parent: { subscription_details: { subscription: "sub_1" } },
    lines: {
      data: [
        {
          period: { start: sec(NEW_PERIOD_START), end: sec(NEW_PERIOD_END) },
          parent: { subscription_item_details: { subscription: "sub_1" } },
        },
      ],
    },
    ...overrides,
  } as any
}

/** A basil subscription: no top-level current_period_*, period on the item. */
function basilSubscription(overrides: Record<string, unknown> = {}, price: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    items: {
      data: [
        {
          current_period_start: sec(NEW_PERIOD_START),
          current_period_end: sec(NEW_PERIOD_END),
          price: { id: "price_unknown", metadata: {}, ...price },
        },
      ],
    },
    ...overrides,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.userSubscription.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.userSubscription.update.mockResolvedValue({ id: "row_1" })
  prismaMock.subscriptionPlan.upsert.mockResolvedValue({ id: "plan_supreme" })
})

describe("renewal period (invoice.payment_succeeded)", () => {
  it("writes the line item's service period, not invoice.period_end", () => {
    const end = invoiceServicePeriodEnd(basilRenewalInvoice())
    expect(end?.toISOString()).toBe(new Date(NEW_PERIOD_END).toISOString())
  })

  it("a renewed subscriber still resolves ACTIVE after the handler runs", async () => {
    await refreshSubscriptionPeriod(basilRenewalInvoice(), "user_1")
    const written = prismaMock.userSubscription.updateMany.mock.calls[0][0]
    expect(written.where).toEqual({ userId: "user_1", stripeSubscriptionId: "sub_1" })
    const row = { status: written.data.status, currentPeriodEnd: written.data.currentPeriodEnd }
    expect(resolveSubscriptionStatus(row, NOW)).toBe("active")
  })

  it("POSITIVE CONTROL: the old rule (invoice.period_end) reads the same subscriber as expired", () => {
    const invoice = basilRenewalInvoice()
    const oldRule = { status: "active", currentPeriodEnd: new Date(invoice.period_end * 1000) }
    expect(resolveSubscriptionStatus(oldRule, NOW)).toBe("expired")
  })

  it("leaves the stored period alone when the invoice carries no line periods", async () => {
    await refreshSubscriptionPeriod(basilRenewalInvoice({ lines: { data: [] } }), "user_1")
    const written = prismaMock.userSubscription.updateMany.mock.calls[0][0]
    expect(written.data).not.toHaveProperty("currentPeriodEnd")
  })
})

describe("basil field locations", () => {
  it("reads the subscription id from invoice.parent (basil) and invoice.subscription (legacy)", () => {
    expect(invoiceSubscriptionId(basilRenewalInvoice())).toBe("sub_1")
    expect(invoiceSubscriptionId({ subscription: "sub_legacy" } as any)).toBe("sub_legacy")
    expect(
      invoiceSubscriptionId({
        lines: { data: [{ parent: { subscription_item_details: { subscription: "sub_line" } } }] },
      } as any)
    ).toBe("sub_line")
    expect(invoiceSubscriptionId({} as any)).toBeNull()
  })

  it("reads the period from the items when the top-level fields are absent", () => {
    const { start, end } = subscriptionPeriods(basilSubscription())
    expect(start?.toISOString()).toBe(new Date(NEW_PERIOD_START).toISOString())
    expect(end?.toISOString()).toBe(new Date(NEW_PERIOD_END).toISOString())
  })

  it("still reads the top-level fields on an older API version", () => {
    const { end } = subscriptionPeriods({
      current_period_start: sec(NEW_PERIOD_START),
      current_period_end: sec(NEW_PERIOD_END),
      items: { data: [] },
    } as any)
    expect(end?.toISOString()).toBe(new Date(NEW_PERIOD_END).toISOString())
  })
})

describe("customer.subscription.updated", () => {
  it("writes the item period instead of null (null reads as active FOREVER)", async () => {
    prismaMock.userSubscription.findUnique.mockResolvedValue({ id: "row_1", userId: "user_1" })
    await updateSubscriptionFromStripeEvent(basilSubscription(), "user_1")
    const data = prismaMock.userSubscription.update.mock.calls[0][0].data
    expect(data.currentPeriodEnd?.toISOString()).toBe(new Date(NEW_PERIOD_END).toISOString())
  })

  it("never writes a null period when the event carries none", async () => {
    prismaMock.userSubscription.findUnique.mockResolvedValue({ id: "row_1", userId: "user_1" })
    await updateSubscriptionFromStripeEvent(basilSubscription({ items: { data: [] } }), "user_1")
    const data = prismaMock.userSubscription.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty("currentPeriodEnd")
    expect(data).not.toHaveProperty("currentPeriodStart")
  })

  it("follows a plan switch via price.metadata.af_sku", async () => {
    prismaMock.userSubscription.findUnique.mockResolvedValue({ id: "row_1", userId: "user_1" })
    await updateSubscriptionFromStripeEvent(
      basilSubscription({}, { id: "price_x", metadata: { af_sku: "af_supreme_monthly" } }),
      "user_1"
    )
    const data = prismaMock.userSubscription.update.mock.calls[0][0].data
    expect(data.sku).toBe("af_supreme_monthly")
    expect(data.subscriptionPlanId).toBe("plan_supreme")
    expect(prismaMock.subscriptionPlan.upsert.mock.calls[0][0].where).toEqual({ code: "af_supreme" })
  })

  it("follows a plan switch via the STRIPE_PRICE_AF_* env var when the price has no tag", () => {
    const sku = resolveSubscriptionSkuFromStripe(basilSubscription({}, { id: "price_comm_y" }), {
      STRIPE_PRICE_AF_COMMISSIONER_YEARLY: "price_comm_y",
    } as NodeJS.ProcessEnv)
    expect(sku).toBe("af_commissioner_yearly")
  })

  it("leaves the plan alone when the price is not one of ours", async () => {
    prismaMock.userSubscription.findUnique.mockResolvedValue({ id: "row_1", userId: "user_1" })
    await updateSubscriptionFromStripeEvent(basilSubscription(), "user_1")
    const data = prismaMock.userSubscription.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty("sku")
    expect(data).not.toHaveProperty("subscriptionPlanId")
  })

  it("only adopts a row with no subscription id yet — never another plan's row", async () => {
    prismaMock.userSubscription.findUnique.mockResolvedValue(null)
    prismaMock.userSubscription.findFirst.mockResolvedValue(null)
    await updateSubscriptionFromStripeEvent(basilSubscription(), "user_1")
    expect(prismaMock.userSubscription.findFirst.mock.calls[0][0].where).toMatchObject({
      userId: "user_1",
      stripeSubscriptionId: null,
    })
    expect(prismaMock.userSubscription.update).not.toHaveBeenCalled()
  })
})

describe("customer-wide fallbacks never touch a cancelled row", () => {
  it("invoice.payment_failed without a subscription id excludes canceled rows", async () => {
    await markSubscriptionPastDue({ id: "in_x", customer: "cus_1", lines: { data: [] } } as any, "user_1")
    expect(prismaMock.userSubscription.updateMany.mock.calls[0][0].where).toMatchObject({
      status: { not: "canceled" },
    })
  })

  it("invoice.payment_succeeded without a subscription id excludes canceled rows", async () => {
    await refreshSubscriptionPeriod(
      basilRenewalInvoice({ parent: null, lines: { data: [{ period: { end: sec(NEW_PERIOD_END) } }] } }),
      "user_1"
    )
    expect(prismaMock.userSubscription.updateMany.mock.calls[0][0].where).toMatchObject({
      status: { not: "canceled" },
    })
  })
})

describe("duplicatePlanReason", () => {
  it("refuses an exact repeat and anything on top of Supreme, allows a different plan", () => {
    expect(duplicatePlanReason(new Set(["af_pro"]), "af_pro")).toBe("same_plan")
    expect(duplicatePlanReason(new Set(["af_supreme"]), "af_commissioner")).toBe("has_supreme")
    expect(duplicatePlanReason(new Set(["af_pro"]), "af_supreme")).toBeNull()
    expect(duplicatePlanReason(new Set(), "af_pro")).toBeNull()
  })
})
