import { describe, expect, it, vi } from "vitest"
import type Stripe from "stripe"
import { cancelSubscriptionsOnDelete } from "@/lib/account/cancelSubscriptionsOnDelete"

type Row = { stripeSubscriptionId: string | null; stripeCustomerId: string | null; source: string; status: string }

function fakeStripe(subs: Record<string, Stripe.Subscription.Status | "missing">, listed: Record<string, string[]> = {}) {
  const cancel = vi.fn(async (id: string) => ({ id, status: "canceled" }))
  const retrieve = vi.fn(async (id: string) => {
    const status = subs[id]
    if (!status || status === "missing") throw Object.assign(new Error("No such subscription"), { code: "resource_missing" })
    return { id, status }
  })
  const list = vi.fn(({ customer }: { customer: string }) => {
    const ids = listed[customer] ?? []
    return (async function* () {
      for (const id of ids) yield { id }
    })()
  })
  return { stripe: { subscriptions: { cancel, retrieve, list } } as unknown as Stripe, cancel, retrieve, list }
}

const deps = (rows: Row[], stripe: Stripe) => ({
  findSubscriptions: async () => rows,
  getStripe: vi.fn(() => stripe),
})

describe("cancelSubscriptionsOnDelete", () => {
  it("never touches Stripe for an account with no Stripe history (no key needed)", async () => {
    const { stripe } = fakeStripe({})
    const d = deps([], stripe)
    expect(await cancelSubscriptionsOnDelete("u1", d)).toEqual({ cancelled: [], hasAppleSubscription: false })
    expect(d.getStripe).not.toHaveBeenCalled()
  })

  it("cancels the recorded subscription AND one only Stripe knows about, immediately with no proration", async () => {
    const f = fakeStripe({ sub_db: "active", sub_orphan: "past_due" }, { cus_1: ["sub_orphan"] })
    const result = await cancelSubscriptionsOnDelete(
      "u1",
      deps([{ stripeSubscriptionId: "sub_db", stripeCustomerId: "cus_1", source: "stripe", status: "active" }], f.stripe),
    )
    expect(result.cancelled.sort()).toEqual(["sub_db", "sub_orphan"])
    expect(f.list).toHaveBeenCalledWith({ customer: "cus_1", limit: 100 })
    expect(f.cancel).toHaveBeenCalledWith(
      "sub_db",
      expect.objectContaining({ invoice_now: false, prorate: false }),
    )
  })

  it("skips subscriptions already cancelled or gone, so a retry is safe", async () => {
    const f = fakeStripe({ sub_done: "canceled", sub_expired: "incomplete_expired", sub_gone: "missing" })
    const rows: Row[] = ["sub_done", "sub_expired", "sub_gone"].map((id) => ({
      stripeSubscriptionId: id,
      stripeCustomerId: null,
      source: "stripe",
      status: "canceled",
    }))
    expect((await cancelSubscriptionsOnDelete("u1", deps(rows, f.stripe))).cancelled).toEqual([])
    expect(f.cancel).not.toHaveBeenCalled()
  })

  it("THROWS when Stripe refuses, so the caller cannot erase a still-billed account", async () => {
    const f = fakeStripe({ sub_db: "active" })
    f.cancel.mockRejectedValueOnce(new Error("stripe down"))
    await expect(
      cancelSubscriptionsOnDelete(
        "u1",
        deps([{ stripeSubscriptionId: "sub_db", stripeCustomerId: null, source: "stripe", status: "active" }], f.stripe),
      ),
    ).rejects.toThrow("stripe down")
  })

  it("reports an App Store subscription instead of trying to cancel it", async () => {
    const f = fakeStripe({})
    const d = deps([{ stripeSubscriptionId: null, stripeCustomerId: null, source: "apple", status: "active" }], f.stripe)
    expect(await cancelSubscriptionsOnDelete("u1", d)).toEqual({ cancelled: [], hasAppleSubscription: true })
    expect(d.getStripe).not.toHaveBeenCalled()
  })
})
