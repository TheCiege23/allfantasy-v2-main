/**
 * The paid-state card check (owner's decision, 2026-09-24): a purchase whose card
 * billing address is in a restricted state is refused, refunded and locked.
 *
 *   1. lib/geo/billingAddressState — which restricted state an address is in.
 *   2. lib/subscription/paidStateRefusal — lock, cancel, refund, in that order.
 */
import type Stripe from "stripe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  RESTRICTED_STATE_ZIP3_RANGES,
  restrictedBillingState,
  restrictedStateForZip,
} from "@/lib/geo/billingAddressState"
import { RESTRICTED_STATES } from "@/lib/geo/restrictedStates"
import { refuseCheckoutForRestrictedBillingState } from "@/lib/subscription/paidStateRefusal"

describe("restrictedStateForZip", () => {
  it.each([
    ["96701", "HI"],
    ["96813", "HI"],
    ["83201", "ID"],
    ["83877", "ID"],
    ["59001", "MT"],
    ["59937", "MT"],
    ["88901", "NV"],
    ["89501", "NV"],
    ["89883", "NV"],
    ["98001", "WA"],
    ["99403", "WA"],
  ])("%s is %s", (zip, state) => {
    expect(restrictedStateForZip(zip)).toBe(state)
  })

  // Each neighbour sits just outside a range: the boundary is where a table goes wrong.
  it.each([
    ["96910", "Guam, next to Hawaii"],
    ["83101", "Wyoming, below Idaho"],
    ["84101", "Utah, above Idaho"],
    ["58001", "North Dakota, below Montana"],
    ["97201", "Oregon, below Washington"],
    ["99501", "Alaska, above Washington"],
    ["90210", "California"],
    ["10001", "New York"],
  ])("%s (%s) is not restricted", (zip) => {
    expect(restrictedStateForZip(zip)).toBeNull()
  })

  it("reads ZIP+4 in every common spelling", () => {
    expect(restrictedStateForZip("89501-1234")).toBe("NV")
    expect(restrictedStateForZip("895011234")).toBe("NV")
    expect(restrictedStateForZip(" 89501 1234 ")).toBe("NV")
  })

  it("is null for anything that is not a US ZIP", () => {
    for (const bad of [null, undefined, "", "8950", "ABCDE", "SW1A 1AA", "895O1"]) {
      expect(restrictedStateForZip(bad)).toBeNull()
    }
  })
})

describe("the ZIP table covers the restriction list", () => {
  it("has ranges for every restricted state — adding a state without them fails here", () => {
    for (const { code } of RESTRICTED_STATES) {
      expect(RESTRICTED_STATE_ZIP3_RANGES[code]?.length ?? 0, code).toBeGreaterThan(0)
    }
  })

  it("lists no state the restriction list does not", () => {
    const codes = new Set(RESTRICTED_STATES.map((s) => s.code))
    for (const state of Object.keys(RESTRICTED_STATE_ZIP3_RANGES)) expect(codes.has(state), state).toBe(true)
  })

  it("has no overlapping ranges", () => {
    const all = Object.entries(RESTRICTED_STATE_ZIP3_RANGES).flatMap(([s, rs]) => rs.map(([lo, hi]) => ({ s, lo, hi })))
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue
        expect(a.hi < b.lo || b.hi < a.lo, `${a.s} ${a.lo}-${a.hi} vs ${b.s} ${b.lo}-${b.hi}`).toBe(true)
      }
    }
  })
})

describe("restrictedBillingState", () => {
  it("decides by the ZIP — the field the card issuer checks", () => {
    expect(restrictedBillingState({ country: "US", postal_code: "89501", state: "CA" })).toEqual({
      stateCode: "NV",
      source: "postal_code",
    })
  })

  it("still counts a typed restricted state when the ZIP says somewhere else", () => {
    expect(restrictedBillingState({ country: "US", postal_code: "94107", state: "NV" })).toEqual({
      stateCode: "NV",
      source: "state",
    })
  })

  it("reads a typed state by name or in any case", () => {
    expect(restrictedBillingState({ country: "US", state: "Nevada" })?.stateCode).toBe("NV")
    expect(restrictedBillingState({ country: "us", state: "mt" })?.stateCode).toBe("MT")
  })

  it("counts Washington, which is stricter than a paid-block state", () => {
    expect(restrictedBillingState({ country: "US", postal_code: "98101" })?.stateCode).toBe("WA")
  })

  it("passes an unrestricted US address", () => {
    expect(restrictedBillingState({ country: "US", postal_code: "94107", state: "CA" })).toBeNull()
  })

  it("passes a non-US address even with a ZIP-shaped postcode", () => {
    // A German postcode is five digits; 89501 would read as Reno.
    expect(restrictedBillingState({ country: "DE", postal_code: "89501", state: "NV" })).toBeNull()
  })

  it("is unknown — not restricted — without a country or an address", () => {
    expect(restrictedBillingState({ postal_code: "89501" })).toBeNull()
    expect(restrictedBillingState(null)).toBeNull()
    expect(restrictedBillingState({ country: "US" })).toBeNull()
  })
})

// ─── The refusal ──────────────────────────────────────────────────────────────

const NV = { country: "US", postal_code: "89501", state: "NV", line1: "1 Main St", city: "Reno", line2: null }
const CA = { ...NV, postal_code: "94107", state: "CA", city: "San Francisco" }

function session(overrides: Partial<Stripe.Checkout.Session>): Stripe.Checkout.Session {
  return {
    id: "cs_test_1",
    mode: "subscription",
    subscription: "sub_1",
    invoice: "in_1",
    payment_intent: null,
    amount_total: 999,
    customer_details: { address: NV } as Stripe.Checkout.Session.CustomerDetails,
    ...overrides,
  } as Stripe.Checkout.Session
}

function fakeStripe() {
  const calls: string[] = []
  const stripe = {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        calls.push(`retrieve:${id}`)
        return { id, status: "active" }
      }),
      cancel: vi.fn(async (id: string) => {
        calls.push(`cancel:${id}`)
        return { id, status: "canceled" }
      }),
    },
    invoicePayments: {
      list: vi.fn(async () => ({ data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_invoice" } }] })),
    },
    refunds: {
      create: vi.fn(async (params: { payment_intent?: string; charge?: string }) => {
        calls.push(`refund:${params.payment_intent ?? params.charge}`)
        return { id: "re_1" }
      }),
    },
  }
  return { stripe, calls }
}

describe("refuseCheckoutForRestrictedBillingState", () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  it("locks, then cancels, then refunds a subscription's first payment", async () => {
    const { stripe, calls } = fakeStripe()
    const lockAccount = vi.fn(async () => {
      calls.push("lock")
    })

    const out = await refuseCheckoutForRestrictedBillingState(session({}), "user_1", {
      stripe: stripe as unknown as Stripe,
      lockAccount,
    })

    expect(out).toMatchObject({ stateCode: "NV", source: "postal_code", canceledSubscriptionId: "sub_1", refundedPaymentIntentId: "pi_invoice" })
    expect(calls).toEqual(["lock", "retrieve:sub_1", "cancel:sub_1", "refund:pi_invoice"])
    expect(lockAccount).toHaveBeenCalledWith("user_1")
    expect(stripe.invoicePayments.list).toHaveBeenCalledWith({ invoice: "in_1", limit: 10 })
    // The refund is keyed on the session, so a retried event cannot refund twice.
    expect(stripe.refunds.create.mock.calls[0][1]).toEqual({ idempotencyKey: "af-paid-state-refund-cs_test_1" })
  })

  it("refunds a one-time purchase by its own payment intent and cancels nothing", async () => {
    const { stripe, calls } = fakeStripe()
    await refuseCheckoutForRestrictedBillingState(
      session({ mode: "payment", subscription: null, invoice: null, payment_intent: "pi_tokens" }),
      "user_1",
      { stripe: stripe as unknown as Stripe, lockAccount: async () => {} },
    )
    expect(calls).toEqual(["refund:pi_tokens"])
    expect(stripe.invoicePayments.list).not.toHaveBeenCalled()
  })

  it("does nothing at all for an unrestricted address", async () => {
    const { stripe, calls } = fakeStripe()
    const lockAccount = vi.fn()
    const out = await refuseCheckoutForRestrictedBillingState(
      session({ customer_details: { address: CA } as Stripe.Checkout.Session.CustomerDetails }),
      "user_1",
      { stripe: stripe as unknown as Stripe, lockAccount },
    )
    expect(out).toBeNull()
    expect(calls).toEqual([])
    expect(lockAccount).not.toHaveBeenCalled()
  })

  it("does nothing when the session carries no address — unknown is not restricted", async () => {
    const { stripe, calls } = fakeStripe()
    const out = await refuseCheckoutForRestrictedBillingState(session({ customer_details: null }), "user_1", {
      stripe: stripe as unknown as Stripe,
      lockAccount: async () => {},
    })
    expect(out).toBeNull()
    expect(calls).toEqual([])
  })

  it("refunds nothing when nothing was paid, but still cancels and locks", async () => {
    const { stripe, calls } = fakeStripe()
    await refuseCheckoutForRestrictedBillingState(session({ amount_total: 0 }), "user_1", {
      stripe: stripe as unknown as Stripe,
      lockAccount: async () => {
        calls.push("lock")
      },
    })
    expect(calls).toEqual(["lock", "retrieve:sub_1", "cancel:sub_1"])
  })

  it("is safe to run again: an ended subscription and an already-refunded charge are done, not errors", async () => {
    const { stripe, calls } = fakeStripe()
    stripe.subscriptions.retrieve.mockResolvedValueOnce({ id: "sub_1", status: "canceled" })
    stripe.refunds.create.mockRejectedValueOnce(Object.assign(new Error("already"), { code: "charge_already_refunded" }))
    await expect(
      refuseCheckoutForRestrictedBillingState(session({}), "user_1", {
        stripe: stripe as unknown as Stripe,
        lockAccount: async () => {},
      }),
    ).resolves.toMatchObject({ stateCode: "NV" })
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
    expect(calls).not.toContain("cancel:sub_1")
  })

  it("throws on any other refund failure, so Stripe retries the event", async () => {
    const { stripe } = fakeStripe()
    stripe.refunds.create.mockRejectedValueOnce(Object.assign(new Error("api down"), { code: "api_error" }))
    await expect(
      refuseCheckoutForRestrictedBillingState(session({}), "user_1", {
        stripe: stripe as unknown as Stripe,
        lockAccount: async () => {},
      }),
    ).rejects.toThrow("api down")
  })

  it("throws when the lock cannot be written, before touching Stripe", async () => {
    const { stripe, calls } = fakeStripe()
    await expect(
      refuseCheckoutForRestrictedBillingState(session({}), "user_1", {
        stripe: stripe as unknown as Stripe,
        lockAccount: async () => {
          throw new Error("db down")
        },
      }),
    ).rejects.toThrow("db down")
    expect(calls).toEqual([])
  })

  it("logs the state but never the address or ZIP", async () => {
    const { stripe } = fakeStripe()
    await refuseCheckoutForRestrictedBillingState(session({}), "user_1", {
      stripe: stripe as unknown as Stripe,
      lockAccount: async () => {},
    })
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n")
    expect(logged).toContain("NV")
    expect(logged).not.toContain("89501")
    expect(logged).not.toContain("Main St")
    expect(logged).not.toContain("Reno")
  })
})
