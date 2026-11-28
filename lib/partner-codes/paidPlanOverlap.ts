import 'server-only'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { getMonetizationCatalogItemBySku, type MonetizationSku } from '@/lib/monetization/catalog'
import { resolveSubscriptionStatus } from '@/lib/subscription/SubscriptionStatusResolver'
import type { FreePlan } from './meters'

/**
 * Owner's rule (2026-11-23): when a commissioner unlocks a free plan, stop charging them for any
 * paid plan it already covers. AF Supreme includes AF Pro, AF Commissioner and — since 2026-11-27 — AF
 * Legacy (SUPREME_INCLUDES in lib/monetization/stripeCustomerForUser.ts), so a free Supreme plan stops
 * a Legacy renewal too.
 *
 *  - Stripe: renewal is turned off (`cancel_at_period_end`). They keep what they paid for until the
 *    period ends, then the free plan carries on. No refund, no proration, nothing taken away early.
 *  - Apple / Google: a server cannot cancel a store subscription. The caller emails them how to.
 *
 * Idempotent: a subscription already set to end is skipped, so the daily job can call this every
 * day (which also catches a plan they buy again later while the free plan is on).
 */
export const COVERED_BY: Record<Exclude<FreePlan, 'none'>, ReadonlySet<string>> = {
  supreme: new Set(['af_supreme', 'af_commissioner', 'af_pro', 'af_war_room']),
  commissioner: new Set(['af_commissioner']),
}

export type OverlapResult = {
  /** Stripe subscriptions whose renewal was turned off just now. */
  stopped: Array<{ subscriptionId: string; planFamily: string; endsAt: Date | null }>
  /** Store subscriptions we cannot cancel; the member has to. */
  storeOwned: Array<{ source: string; planFamily: string }>
}

export async function stopPaidPlansCoveredBy(args: {
  stripe: Stripe
  userId: string
  freePlan: FreePlan
  partnerCodeId: string
}): Promise<OverlapResult> {
  const out: OverlapResult = { stopped: [], storeOwned: [] }
  if (args.freePlan === 'none') return out
  const covered = COVERED_BY[args.freePlan]
  const rows = await prisma.userSubscription.findMany({
    where: { userId: args.userId, source: { in: ['stripe', 'apple', 'google_play'] } },
    select: { source: true, sku: true, status: true, currentPeriodEnd: true, gracePeriodEnd: true, expiresAt: true, stripeSubscriptionId: true, canceledAt: true },
  })
  for (const row of rows) {
    const status = resolveSubscriptionStatus(row)
    if (status !== 'active' && status !== 'grace' && status !== 'past_due') continue
    const family = row.sku ? getMonetizationCatalogItemBySku(row.sku as MonetizationSku)?.planFamily : null
    if (!family || !covered.has(family)) continue
    if (row.source !== 'stripe') {
      out.storeOwned.push({ source: row.source, planFamily: family })
      continue
    }
    if (!row.stripeSubscriptionId) continue
    const sub = await args.stripe.subscriptions.retrieve(row.stripeSubscriptionId)
    if (sub.cancel_at_period_end || sub.status === 'canceled' || sub.cancel_at) continue
    await args.stripe.subscriptions.update(row.stripeSubscriptionId, {
      cancel_at_period_end: true,
      metadata: { ...sub.metadata, af_partner_reward_stop: args.partnerCodeId },
    })
    out.stopped.push({ subscriptionId: row.stripeSubscriptionId, planFamily: family, endsAt: row.currentPeriodEnd })
  }
  return out
}

const PLAN_LABEL: Record<string, string> = { af_supreme: 'AF Supreme', af_commissioner: 'AF Commissioner', af_pro: 'AF Pro' }

/** The email for a commissioner whose paid plan we just stopped, or who has to stop a store one. */
export function overlapEmail(freePlan: Exclude<FreePlan, 'none'>, r: OverlapResult): { subject: string; bodyHtml: string } | null {
  if (!r.stopped.length && !r.storeOwned.length) return null
  const free = freePlan === 'supreme' ? 'AF Supreme' : 'AF Commissioner'
  const lines: string[] = [`Your Partner Code just unlocked <strong>${free} free</strong>.`]
  for (const s of r.stopped) {
    const until = s.endsAt ? ` You keep it until ${s.endsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}, then your free plan carries on.` : ''
    lines.push(`We turned off renewal of your paid ${PLAN_LABEL[s.planFamily] ?? 'plan'}, so you won't be charged again.${until}`)
  }
  for (const s of r.storeOwned) {
    const store = s.source === 'apple' ? 'the App Store (Settings, your name, Subscriptions)' : 'Google Play (Play Store, Payments & subscriptions)'
    lines.push(`Your paid ${PLAN_LABEL[s.planFamily] ?? 'plan'} is billed through ${store}. We can't cancel it for you, so cancel it there to stop being charged. Your free plan is already on.`)
  }
  lines.push('If your free plan ever ends, you can subscribe again any time.')
  return { subject: `${free} is now free for you`, bodyHtml: lines.join('<br><br>') }
}
