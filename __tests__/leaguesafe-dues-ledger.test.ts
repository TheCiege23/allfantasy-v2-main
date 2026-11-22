import { describe, expect, it } from "vitest"
import { deriveLeagueSafeDues, type DuesEntryAmount } from "@/lib/leaguesafe/dues-ledger"

const asOf = new Date("2026-11-15T12:00:00Z")
const derive = (entries: DuesEntryAmount[], extra = {}) =>
  deriveLeagueSafeDues({ duesAmountCents: 10000, entries, asOf, ...extra })

describe("LeagueSafe derived dues", () => {
  it("derives unpaid, partial, and paid without a persisted status", () => {
    expect(derive([])).toMatchObject({ status: "unpaid", owedCents: 10000 })
    expect(derive([{ type: "payment", amountCents: 3000 }])).toMatchObject({ status: "partial", owedCents: 7000 })
    expect(derive([{ type: "payment", amountCents: 10000 }])).toMatchObject({ status: "paid", owedCents: 0 })
  })
  it("refunds reverse paid credit and late fees increase the assessment", () => {
    expect(derive([
      { type: "payment", amountCents: 10000 }, { type: "refund", amountCents: 3000 },
      { type: "late_fee", amountCents: 500 },
    ])).toMatchObject({ dueCents: 10500, paidCents: 7000, owedCents: 3500, status: "partial" })
  })
  it("tracks payouts separately from dues paid", () => {
    expect(derive([
      { type: "payment", amountCents: 10000 }, { type: "payout", amountCents: 50000 },
    ])).toMatchObject({ paidCents: 10000, owedCents: 0, payoutCents: 50000, status: "paid" })
  })
  it("applies signed adjustments and preserves overpayment credit", () => {
    expect(derive([
      { type: "payment", amountCents: 12000 }, { type: "adjustment", amountCents: -500 },
      { type: "adjustment", amountCents: 100 },
    ])).toMatchObject({ paidCents: 11600, creditCents: 1600, owedCents: 0 })
  })
  it("does not clamp an excess refund into an apparent zero balance", () => {
    expect(derive([{ type: "refund", amountCents: 500 }])).toMatchObject({ paidCents: -500, owedCents: 10500 })
  })
  it("honors a member's zero-dues override and leaves input unchanged", () => {
    const entries = Object.freeze([{ type: "payout" as const, amountCents: 100 }])
    expect(deriveLeagueSafeDues({ duesAmountCents: 10000, memberDuesAmountCents: 0, entries, asOf }))
      .toMatchObject({ dueCents: 0, status: "paid", payoutCents: 100 })
    expect(entries).toEqual([{ type: "payout", amountCents: 100 }])
  })
  it("marks only outstanding balances overdue, strictly after the deadline", () => {
    expect(derive([], { dueAt: asOf }).status).toBe("unpaid")
    const dueAt = new Date(asOf.getTime() - 1)
    expect(derive([{ type: "payment", amountCents: 1 }], { dueAt }).status).toBe("overdue")
    expect(derive([{ type: "payment", amountCents: 10000 }], { dueAt }).status).toBe("paid")
  })
  it.each([NaN, Infinity, 1.5, -1, 2147483648])("rejects invalid assessment %s", (amount) => {
    expect(() => derive([], { duesAmountCents: amount })).toThrow(RangeError)
    expect(() => derive([], { memberDuesAmountCents: amount })).toThrow(RangeError)
  })
  it.each(["payment", "refund", "late_fee", "payout"] as const)("rejects negative and zero %s", (type) => {
    for (const amountCents of [-1, 0, 1.5, NaN, Infinity, 2147483648]) {
      expect(() => derive([{ type, amountCents }])).toThrow(RangeError)
    }
  })
  it("rejects invalid adjustment values, dates, and unknown event types", () => {
    for (const amountCents of [0, 0.1, NaN, -2147483649]) {
      expect(() => derive([{ type: "adjustment", amountCents }])).toThrow(RangeError)
    }
    expect(() => derive([], { asOf: new Date(NaN) })).toThrow(RangeError)
    expect(() => derive([], { dueAt: new Date(NaN) })).toThrow(RangeError)
    expect(() => derive([{ type: "allocation_approved" as DuesEntryAmount["type"], amountCents: 1 }])).toThrow(TypeError)
  })
})
