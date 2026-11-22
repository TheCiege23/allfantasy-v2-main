import 'server-only'

import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe-client'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { emailWithheldByUnsubscribe, readEmailSubscription, type EmailSubscriptionState } from '@/lib/email/emailSubscription'
import { planDisplayNameForSku } from '@/lib/monetization/planPresentation'
import {
  BILLING_PORTAL_HREF,
  BILLING_SETTINGS_HREF,
  FINAL_NOTICE_WINDOW,
  formatBillingDate,
  LIVE_STATUSES,
  paymentFinalNotice,
  TRIAL_ENDING_WINDOW,
  trialEndingNotice,
  trialWeekSummary,
  WIN_BACK_WINDOW,
  winBackNotice,
} from './retention'

/**
 * The scheduled half of the retention work (rules and words in `./retention.ts`), hourly from
 * `/api/cron/reap-sync-runs` beside the annual-renewal reminder (the cron schedule is at its ceiling).
 * Every window is a day wide, so each case is seen by many hourly runs; each notice goes out ONCE
 * because it is keyed on the subscription and the date (`dedupePrefix`), which the dispatcher's durable
 * transport and the inbox both claim once. Nothing here throws: a failure is counted, never raised.
 */

const LIMIT = 200

export type RetentionPassResult = {
  ran: true
  paymentFinal: { candidates: number; sent: number; failed: number }
  trialEnding: { candidates: number; sent: number; notRenewing: number; failed: number }
  winBack: { candidates: number; sent: number; cameBack: number; failed: number }
}

type Deps = {
  db?: typeof prisma
  now?: Date
  notify?: typeof dispatchNotification
  stripe?: () => Pick<Stripe, 'subscriptions'>
  readSubscription?: (email: string | null | undefined) => Promise<EmailSubscriptionState>
}

const day = (d: Date) => d.toISOString().slice(0, 10)

export async function runRetentionPasses(deps: Deps = {}): Promise<RetentionPassResult> {
  const db = deps.db ?? prisma
  const now = deps.now ?? new Date()
  const notify = deps.notify ?? dispatchNotification
  const stripe = deps.stripe ?? (() => getStripeClient())
  const readSubscription = deps.readSubscription ?? readEmailSubscription
  const at = (ms: number) => new Date(now.getTime() + ms)
  const result: RetentionPassResult = {
    ran: true,
    paymentFinal: { candidates: 0, sent: 0, failed: 0 },
    trialEnding: { candidates: 0, sent: 0, notRenewing: 0, failed: 0 },
    winBack: { candidates: 0, sent: 0, cameBack: 0, failed: 0 },
  }

  /* 1 ── The card still has not gone through and access ends tomorrow. */
  const pastDue = await db.userSubscription
    .findMany({
      where: { source: 'stripe', status: 'past_due', gracePeriodEnd: { gte: at(FINAL_NOTICE_WINDOW.fromMs), lte: at(FINAL_NOTICE_WINDOW.toMs) } },
      select: { id: true, userId: true, gracePeriodEnd: true },
      take: LIMIT,
    })
    .catch(() => [] as Array<{ id: string; userId: string; gracePeriodEnd: Date | null }>)
  result.paymentFinal.candidates = pastDue.length
  for (const row of pastDue) {
    if (!row.gracePeriodEnd) continue
    try {
      const notice = paymentFinalNotice(formatBillingDate(row.gracePeriodEnd))
      await notify({
        userIds: [row.userId], category: 'system_account', productType: 'app', type: 'billing_payment_final',
        title: notice.title, body: notice.body, actionHref: BILLING_PORTAL_HREF, actionLabel: 'Update card', severity: 'high',
        dedupePrefix: `billing-payment-final:${row.id}:${day(row.gracePeriodEnd)}`, skipChannels: { sms: true },
      })
      result.paymentFinal.sent++
    } catch {
      result.paymentFinal.failed++
    }
  }

  /* 2 ── A free trial charges in about two days. */
  const trials = await db.userSubscription
    .findMany({
      where: {
        source: 'stripe', status: 'trialing', canceledAt: null, stripeSubscriptionId: { not: null },
        currentPeriodEnd: { gte: at(TRIAL_ENDING_WINDOW.fromMs), lte: at(TRIAL_ENDING_WINDOW.toMs) },
      },
      select: { id: true, userId: true, sku: true, stripeSubscriptionId: true, currentPeriodEnd: true, createdAt: true },
      take: LIMIT,
    })
    .catch(() => [] as Array<{ id: string; userId: string; sku: string | null; stripeSubscriptionId: string | null; currentPeriodEnd: Date | null; createdAt: Date }>)
  result.trialEnding.candidates = trials.length
  for (const row of trials) {
    if (!row.currentPeriodEnd || !row.stripeSubscriptionId) continue
    try {
      /*
       * ⚠ STRIPE IS THE AUTHORITY: our row does not record cancel_at_period_end (the annual-renewal
       * reminder's lesson). Telling someone who already cancelled "you'll be charged" is worse than
       * saying nothing, so a trial that will not renew gets nothing.
       */
      const sub = await stripe().subscriptions.retrieve(row.stripeSubscriptionId)
      if (sub.status !== 'trialing' || sub.cancel_at_period_end || sub.cancel_at) {
        result.trialEnding.notRenewing++
        continue
      }
      const advice = await db.chimmyAdvice
        .findMany({
          where: { userId: row.userId, givenAt: { gte: row.createdAt }, withdrawnAt: null },
          select: { adviceType: true, leagueId: true },
          take: 500,
        })
        .catch(() => [] as Array<{ adviceType: string; leagueId: string }>)
      const summary = trialWeekSummary({
        lineupCalls: advice.filter((a) => a.adviceType === 'start_sit').length,
        waiverPicks: advice.filter((a) => a.adviceType === 'add').length,
        leagues: new Set(advice.map((a) => a.leagueId)).size,
      })
      const chargeOn = formatBillingDate(row.currentPeriodEnd)
      const notice = trialEndingNotice({ planName: planDisplayNameForSku(row.sku ?? '') || 'AF Pro', chargeOn, summary })
      await notify({
        userIds: [row.userId], category: 'system_account', productType: 'app', type: 'billing_trial_ending',
        title: notice.title, body: notice.body, actionHref: BILLING_SETTINGS_HREF, actionLabel: 'Manage your plan', severity: 'medium',
        dedupePrefix: `billing-trial-ending:${row.id}:${day(row.currentPeriodEnd)}`, skipChannels: { sms: true },
      })
      result.trialEnding.sent++
    } catch {
      result.trialEnding.failed++
    }
  }

  /* 3 ── A plan ended three days ago and they have not come back. */
  const canceled = await db.userSubscription
    .findMany({
      where: { source: 'stripe', status: 'canceled', canceledAt: { gte: at(-WIN_BACK_WINDOW.toMs), lte: at(-WIN_BACK_WINDOW.fromMs) } },
      select: { id: true, userId: true },
      take: LIMIT,
    })
    .catch(() => [] as Array<{ id: string; userId: string }>)
  result.winBack.candidates = canceled.length
  for (const row of canceled) {
    try {
      const [live, grant] = await Promise.all([
        db.userSubscription.count({ where: { userId: row.userId, id: { not: row.id }, status: { in: [...LIVE_STATUSES] } } }),
        db.adminSubscriptionGrant.count({ where: { userId: row.userId, revokedAt: null, expiresAt: { gt: now } } }),
      ])
      if (live > 0 || grant > 0) {
        result.winBack.cameBack++
        continue
      }
      /*
       * A "come back" note is the one MARKETING message here, so it honours Unsubscribe although it goes
       * as an account notice: an unsubscribed (or unreadable) address gets it in the bell only.
       */
      const user = await db.appUser.findUnique({ where: { id: row.userId }, select: { email: true } })
      const withholdEmail = emailWithheldByUnsubscribe(await readSubscription(user?.email ?? null), 'billing_win_back')
      const notice = winBackNotice()
      await notify({
        userIds: [row.userId], category: 'system_account', productType: 'app', type: 'billing_win_back',
        title: notice.title, body: notice.body, actionHref: '/pricing?from=win_back', actionLabel: 'Restart AF Pro', severity: 'low',
        dedupePrefix: `billing-win-back:${row.id}`, skipChannels: { sms: true, ...(withholdEmail ? { email: true } : {}) },
      })
      result.winBack.sent++
    } catch {
      result.winBack.failed++
    }
  }

  return result
}
