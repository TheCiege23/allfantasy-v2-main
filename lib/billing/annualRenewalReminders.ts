import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import { getStripeClient } from "@/lib/stripe-client"
import { sendTemplatedEmail } from "@/lib/resend-client"
import { getMonetizationCatalogItemBySku, type MonetizationSku } from "@/lib/monetization/catalog"
import { planDisplayNameForSku } from "@/lib/monetization/planPresentation"

/**
 * A reminder before an ANNUAL plan renews.
 *
 * Several states require notice 15–45 days before an annual auto-renewal (California's
 * Automatic Renewal Law among them), and the 2026-10 Terms of Service (8.3) promise one. Before
 * this, nothing sent it.
 *
 * Window: renewals between 15 and 30 days out. Rides /api/cron/reap-sync-runs (hourly; the
 * cron schedule is at its ceiling), so every eligible subscription is seen many times inside
 * its window and exactly one reminder goes out per billing period.
 *
 * ⚠ STRIPE IS THE AUTHORITY HERE, NOT user_subscriptions. That table does not record
 * cancel_at_period_end, and the subscription webhook REPLACES its `metadata` on every update,
 * so neither "has this person cancelled?" nor "did we already remind them?" can live there.
 * Each candidate is re-read from Stripe (skipping anyone who has cancelled), the price is
 * Stripe's own preview of the renewal invoice (coupon and tax included), and the "reminded"
 * marker is written to the Stripe subscription's metadata, which Stripe merges and our sync
 * never touches.
 *
 * Apple subscriptions are excluded: the App Store sends its own renewal notices.
 */

export const REMINDER_MIN_DAYS = 15
export const REMINDER_MAX_DAYS = 30
export const REMINDER_MARKER_KEY = "af_renewal_reminder_period_end"

const DAY_MS = 24 * 60 * 60 * 1000

export type RenewalCandidate = {
  id: string
  sku: string | null
  stripeSubscriptionId: string | null
  currentPeriodEnd: Date | null
  user: { email: string | null } | null
}

export type RenewalReminderDeps = {
  findCandidates: (window: { from: Date; to: Date; limit: number }) => Promise<RenewalCandidate[]>
  stripe: () => Pick<Stripe, "subscriptions" | "invoices">
  send: (msg: { to: string; subject: string; html: string }) => Promise<{ ok: boolean; error?: string }>
  baseUrl: string
}

export type RenewalReminderPassResult = {
  ran: true
  candidates: number
  sent: number
  alreadyReminded: number
  skipped: number
  failed: number
}

function defaultDeps(): RenewalReminderDeps {
  return {
    findCandidates: ({ from, to, limit }) =>
      prisma.userSubscription.findMany({
        where: {
          source: "stripe",
          status: { in: ["active", "trialing"] },
          canceledAt: null,
          sku: { endsWith: "_yearly" },
          stripeSubscriptionId: { not: null },
          currentPeriodEnd: { gt: from, lte: to },
        },
        select: {
          id: true,
          sku: true,
          stripeSubscriptionId: true,
          currentPeriodEnd: true,
          user: { select: { email: true } },
        },
        orderBy: { currentPeriodEnd: "asc" },
        take: limit,
      }),
    stripe: getStripeClient,
    send: sendTemplatedEmail,
    baseUrl: (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "https://allfantasy.ai").replace(/\/$/, ""),
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100)
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
}

export function buildRenewalReminderEmail(input: {
  planName: string
  renewsOn: Date
  amount: string
  manageUrl: string
  termsUrl: string
}): { subject: string; html: string } {
  const plan = escapeHtml(input.planName)
  const date = escapeHtml(formatDate(input.renewsOn))
  const amount = escapeHtml(input.amount)
  const subject = `Your ${input.planName} annual plan renews on ${formatDate(input.renewsOn)}`
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;">
  <p>Hi,</p>
  <p>This is a reminder that your <strong>${plan}</strong> annual plan will renew automatically on
  <strong>${date}</strong>, and the payment method on file will be charged <strong>${amount}</strong>.</p>
  <p>If you want to keep your plan, you don't need to do anything.</p>
  <p>If you don't want it to renew, cancel before ${date} in
  <a href="${escapeHtml(input.manageUrl)}">Settings → Billing</a>. You keep your plan until the end of the
  current year, and you won't be charged again.</p>
  <p style="color:#666;font-size:12px;">You're receiving this because you have an annual AllFantasy
  subscription; this notice is required and is sent once per renewal. AllFantasy is operated by Brown Pig LLC,
  1621 Central Ave, Cheyenne, WY 82001. <a href="${escapeHtml(input.termsUrl)}" style="color:#666;">Terms of Service</a>
  · Questions: support@allfantasy.ai</p>
</body></html>`
  return { subject, html }
}

export async function runAnnualRenewalReminderPass(
  opts: { now?: Date; limit?: number; deps?: Partial<RenewalReminderDeps> } = {},
): Promise<RenewalReminderPassResult> {
  const deps = { ...defaultDeps(), ...opts.deps }
  const now = opts.now ?? new Date()
  const from = new Date(now.getTime() + REMINDER_MIN_DAYS * DAY_MS)
  const to = new Date(now.getTime() + REMINDER_MAX_DAYS * DAY_MS)
  const candidates = await deps.findCandidates({ from, to, limit: opts.limit ?? 50 })

  const result: RenewalReminderPassResult = {
    ran: true,
    candidates: candidates.length,
    sent: 0,
    alreadyReminded: 0,
    skipped: 0,
    failed: 0,
  }
  if (candidates.length === 0) return result
  const stripe = deps.stripe()

  for (const c of candidates) {
    const email = c.user?.email ?? null
    if (!c.stripeSubscriptionId || !c.currentPeriodEnd || !email || email.endsWith("@deleted.invalid")) {
      result.skipped += 1
      continue
    }
    try {
      const sub = await stripe.subscriptions.retrieve(c.stripeSubscriptionId)
      const periodKey = String(Math.floor(c.currentPeriodEnd.getTime() / 1000))
      if (sub.metadata?.[REMINDER_MARKER_KEY] === periodKey) {
        result.alreadyReminded += 1
        continue
      }
      // Cancelled (now or at period end) means there is no renewal to warn about.
      if (!["active", "trialing"].includes(sub.status) || sub.cancel_at_period_end || sub.cancel_at) {
        result.skipped += 1
        continue
      }

      let amount: string
      try {
        const preview = await stripe.invoices.createPreview({ subscription: c.stripeSubscriptionId })
        amount = `${formatMoney(preview.total, preview.currency)} (including any tax)`
      } catch {
        const item = c.sku ? getMonetizationCatalogItemBySku(c.sku as MonetizationSku) : null
        if (!item) {
          result.failed += 1
          continue
        }
        amount = `${formatMoney(Math.round(item.amountUsd * 100), "usd")} plus any applicable tax`
      }

      const { subject, html } = buildRenewalReminderEmail({
        planName: planDisplayNameForSku(c.sku) ?? "AllFantasy",
        renewsOn: c.currentPeriodEnd,
        amount,
        manageUrl: `${deps.baseUrl}/settings?tab=billing`,
        termsUrl: `${deps.baseUrl}/terms#section-8-3`,
      })
      const sent = await deps.send({ to: email, subject, html })
      if (!sent.ok) {
        result.failed += 1
        continue
      }
      // Marked only AFTER a successful send: a failed mark costs one possible duplicate next
      // hour, never a missed notice.
      await stripe.subscriptions
        .update(c.stripeSubscriptionId, { metadata: { [REMINDER_MARKER_KEY]: periodKey } })
        .catch(() => undefined)
      result.sent += 1
    } catch {
      result.failed += 1
    }
  }
  return result
}
