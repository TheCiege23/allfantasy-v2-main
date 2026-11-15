import { MONETIZATION } from '@/lib/analytics/eventNames'
import { summarizeRetention, type RetentionEvent, type RetentionStats } from './retention'

/**
 * The admin view of the retention work (lib/billing/retention.ts) over the last 30 days: failed
 * payments and how many were recovered, free trials and how many converted, cancellations and how many
 * came back. Read from the webhook-recorded analytics events, counted by `summarizeRetention` (pure).
 */

const NAMES = {
  failed: MONETIZATION.PAYMENT_FAILED,
  recovered: MONETIZATION.PAYMENT_RECOVERED,
  trialStarted: MONETIZATION.TRIAL_STARTED,
  paid: MONETIZATION.PAID_CONVERSION_CONFIRMED,
  canceled: MONETIZATION.SUBSCRIPTION_CANCELED,
}

type StatsDb = { analyticsEvent: { findMany: (args: unknown) => Promise<RetentionEvent[]> } }

export async function loadRetentionStats(db: StatsDb, now = new Date(), days = 30): Promise<RetentionStats> {
  const rows = await db.analyticsEvent.findMany({
    where: { event: { in: Object.values(NAMES) }, createdAt: { gte: new Date(now.getTime() - days * 86_400_000) } },
    select: { event: true, userId: true, createdAt: true, meta: true },
    take: 20_000,
  })
  return summarizeRetention(rows, NAMES)
}

const pct = (n: number, d: number) => (d > 0 ? ` (${Math.round((n / d) * 100)}%)` : '')

export function describeRetention(s: RetentionStats): { payments: string; trials: string; cancellations: string } {
  return {
    payments: `${s.recoveredInvoices} of ${s.failedInvoices} recovered${pct(s.recoveredInvoices, s.failedInvoices)}`,
    trials: `${s.trialsConverted} of ${s.trialsStarted} converted to paid${pct(s.trialsConverted, s.trialsStarted)}`,
    cancellations: `${s.cameBack} of ${s.cancellations} came back${pct(s.cameBack, s.cancellations)}`,
  }
}
