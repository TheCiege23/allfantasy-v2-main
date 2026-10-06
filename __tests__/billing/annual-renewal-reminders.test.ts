import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  REMINDER_MARKER_KEY,
  buildRenewalReminderEmail,
  runAnnualRenewalReminderPass,
  type RenewalCandidate,
} from "@/lib/billing/annualRenewalReminders"

/*
 * The notice several states require 15–45 days before an annual plan auto-renews (Terms 8.3).
 * Stripe is the authority for "cancelled?" and "already reminded?", because user_subscriptions
 * records neither (see the module header) — so those are the cases pinned here.
 */

const NOW = new Date("2026-10-06T12:00:00Z")
const RENEWS = new Date("2026-10-30T00:00:00Z") // 24 days out
const PERIOD_KEY = String(Math.floor(RENEWS.getTime() / 1000))

const candidate = (over: Partial<RenewalCandidate> = {}): RenewalCandidate => ({
  id: "us-1",
  sku: "af_pro_yearly",
  stripeSubscriptionId: "sub_1",
  currentPeriodEnd: RENEWS,
  user: { email: "fan@example.com" },
  ...over,
})

const retrieve = vi.fn()
const update = vi.fn()
const createPreview = vi.fn()
const send = vi.fn()
const findCandidates = vi.fn()

function run() {
  return runAnnualRenewalReminderPass({
    now: NOW,
    deps: {
      findCandidates,
      stripe: () => ({ subscriptions: { retrieve, update }, invoices: { createPreview } }) as never,
      send,
      baseUrl: "https://allfantasy.ai",
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  findCandidates.mockResolvedValue([candidate()])
  retrieve.mockResolvedValue({ status: "active", cancel_at_period_end: false, cancel_at: null, metadata: {} })
  update.mockResolvedValue({})
  createPreview.mockResolvedValue({ total: 6399, currency: "usd" })
  send.mockResolvedValue({ ok: true })
})

describe("annual renewal reminders", () => {
  it("asks for renewals 15 to 30 days out", async () => {
    await run()
    const { from, to } = findCandidates.mock.calls[0][0]
    expect(from.toISOString()).toBe("2026-10-21T12:00:00.000Z")
    expect(to.toISOString()).toBe("2026-11-05T12:00:00.000Z")
  })

  it("sends one reminder quoting Stripe's previewed amount, then marks the period in Stripe", async () => {
    const res = await run()
    expect(res).toMatchObject({ sent: 1, failed: 0 })
    const msg = send.mock.calls[0][0]
    expect(msg.to).toBe("fan@example.com")
    expect(msg.subject).toBe("Your AF Pro annual plan renews on October 30, 2026")
    expect(msg.html).toContain("$63.99")
    expect(msg.html).toContain("https://allfantasy.ai/settings?tab=billing")
    expect(update).toHaveBeenCalledWith("sub_1", { metadata: { [REMINDER_MARKER_KEY]: PERIOD_KEY } })
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0])
  })

  it("does not remind twice for the same period", async () => {
    retrieve.mockResolvedValue({ status: "active", cancel_at_period_end: false, metadata: { [REMINDER_MARKER_KEY]: PERIOD_KEY } })
    expect(await run()).toMatchObject({ sent: 0, alreadyReminded: 1 })
    expect(send).not.toHaveBeenCalled()
  })

  it("does not tell someone who cancelled that their plan will renew", async () => {
    retrieve.mockResolvedValue({ status: "active", cancel_at_period_end: true, metadata: {} })
    expect(await run()).toMatchObject({ sent: 0, skipped: 1 })
    expect(send).not.toHaveBeenCalled()
  })

  it("falls back to the catalog price when Stripe cannot preview the invoice", async () => {
    createPreview.mockRejectedValue(new Error("preview unavailable"))
    await run()
    expect(send.mock.calls[0][0].html).toContain("$79.99 plus any applicable tax")
  })

  it("leaves the period unmarked when the email fails, so the next hour retries", async () => {
    send.mockResolvedValue({ ok: false, error: "resend down" })
    expect(await run()).toMatchObject({ sent: 0, failed: 1 })
    expect(update).not.toHaveBeenCalled()
  })

  it("skips deleted accounts", async () => {
    findCandidates.mockResolvedValue([candidate({ user: { email: "deleted+u1@deleted.invalid" } })])
    expect(await run()).toMatchObject({ skipped: 1 })
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("escapes what it interpolates into the email", () => {
    const { html } = buildRenewalReminderEmail({
      planName: "<b>x</b>",
      renewsOn: RENEWS,
      amount: "$1",
      manageUrl: "https://allfantasy.ai/settings?tab=billing&a=1",
      termsUrl: "https://allfantasy.ai/terms",
    })
    expect(html).not.toContain("<b>x</b>")
    expect(html).toContain("&amp;a=1")
  })
})
