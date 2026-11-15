import 'server-only'

import { prisma } from '@/lib/prisma'
import { ACQUISITION, MONETIZATION } from '@/lib/analytics/eventNames'
import { estimateMrr, type MrrEstimate } from '@/lib/monetization/mrrEstimate'
import { loadRetentionStats } from '@/lib/billing/retentionStats'
import type { RetentionStats } from '@/lib/billing/retention'
import { loadProWeekStats, type ProWeekStats } from '@/lib/referral/proWeekStats'
import { summarizeGrowth, type GrowthEvent, type GrowthEventNames, type GrowthSummary } from './growthRevenue'

/**
 * The data behind /admin/growth (counting rules in `./growthRevenue.ts`). Read-only. Each section is read
 * on its own and a failed read is REPORTED (`errors`) and leaves that section null — never a zero, which
 * on a revenue page reads as "nobody paid".
 */

export const GROWTH_WINDOWS = [7, 14, 30] as const

const NAMES: GrowthEventNames = {
  landing: ACQUISITION.LANDING_VIEWED,
  signup: ACQUISITION.SIGNUP_COMPLETED,
  emailVerified: ACQUISITION.EMAIL_VERIFIED,
  importStarted: ACQUISITION.IMPORT_STARTED,
  importCompleted: ACQUISITION.IMPORT_COMPLETED,
  trialStarted: MONETIZATION.TRIAL_STARTED,
  checkoutStarted: MONETIZATION.CHECKOUT_STARTED,
  paid: MONETIZATION.PAID_CONVERSION_CONFIRMED,
}

/** Rows read for the user stages. A window that hits it says so rather than undercounting quietly. */
const MAX_EVENTS = 100_000

export type GrowthRevenueReport = {
  days: number
  generatedAt: string
  growth: GrowthSummary | null
  /** True when the user-stage read hit MAX_EVENTS: the counts are a floor. */
  truncated: boolean
  mrr: MrrEstimate | null
  retention: RetentionStats | null
  proWeek: ProWeekStats | null
  errors: string[]
}

const DAY = 86_400_000

export async function getGrowthRevenueReport(opts: { days?: number; now?: Date; db?: typeof prisma } = {}): Promise<GrowthRevenueReport> {
  const db = opts.db ?? prisma
  const days = (GROWTH_WINDOWS as readonly number[]).includes(Number(opts.days)) ? Number(opts.days) : 7
  const now = opts.now ?? new Date()
  const from = new Date(now.getTime() - days * DAY)
  const prevFrom = new Date(now.getTime() - 2 * days * DAY)
  const errors: string[] = []
  const report: GrowthRevenueReport = {
    days, generatedAt: now.toISOString(), growth: null, truncated: false, mrr: null, retention: null, proWeek: null, errors,
  }

  const userStages = Object.values(NAMES).filter((e) => e !== NAMES.landing)
  const [events, visitors, subs, retention, proWeek] = await Promise.allSettled([
    db.analyticsEvent.findMany({
      where: { event: { in: userStages }, createdAt: { gte: prevFrom, lt: now } },
      select: { event: true, userId: true, sessionId: true, createdAt: true, meta: true },
      take: MAX_EVENTS,
    }),
    /*
     * Visitors are anonymous sessions and the most numerous event by far, so they are counted in SQL,
     * per window, rather than loaded row by row.
     */
    db.$queryRaw<Array<{ now: bigint | number; before: bigint | number }>>`
      SELECT
        COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" >= ${from}) AS now,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "createdAt" < ${from}) AS before
      FROM "AnalyticsEvent"
      WHERE event = ${NAMES.landing} AND "createdAt" >= ${prevFrom} AND "createdAt" < ${now} AND "sessionId" IS NOT NULL`,
    db.userSubscription.findMany({ select: { status: true, source: true, sku: true, plan: { select: { code: true } } } }),
    loadRetentionStats(db as never, now, days),
    loadProWeekStats(db as never, now),
  ])

  if (events.status === 'fulfilled') {
    const rows = events.value as unknown as GrowthEvent[]
    report.truncated = rows.length >= MAX_EVENTS
    const growth = summarizeGrowth(rows, NAMES, { from, to: now, prevFrom, days })
    if (visitors.status === 'fulfilled') {
      const v = visitors.value[0]
      const stage = growth.funnel[0]!
      stage.count = Number(v?.now ?? 0)
      stage.previous = Number(v?.before ?? 0)
      const next = growth.funnel[1]!
      next.fromPrevious = stage.count > 0 ? next.count / stage.count : null
    } else {
      errors.push('Could not count visitors')
    }
    report.growth = growth
  } else {
    errors.push('Could not read the funnel events')
  }

  if (subs.status === 'fulfilled') {
    report.mrr = estimateMrr(subs.value.map((s) => ({ status: s.status, source: s.source, sku: s.sku, planCode: s.plan?.code ?? null })))
  } else errors.push('Could not read subscriptions for MRR')
  if (retention.status === 'fulfilled') report.retention = retention.value
  else errors.push('Could not read payment, trial and cancellation events')
  if (proWeek.status === 'fulfilled') report.proWeek = proWeek.value
  else errors.push('Could not read referral weeks')

  return report
}
