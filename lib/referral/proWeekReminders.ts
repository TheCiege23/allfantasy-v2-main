import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { emailWithheldByUnsubscribe, readEmailSubscription, type EmailSubscriptionState } from '@/lib/email/emailSubscription'
import { formatProWeekEnd, proWeekEndingNotice, PRO_WEEK_REASONS } from './proWeek'

/**
 * "Your free week of AF Pro ends tomorrow" — the day-before notice for a referral week (`./proWeek.ts`),
 * with the way to keep it: upgrade, or bring another friend.
 *
 * Rides `/api/cron/reap-sync-runs` (hourly) beside the annual-renewal reminder, because the cron
 * schedule is at its ceiling. Window: weeks ending 12–36 hours from now, so every week is seen by
 * many hourly runs; exactly one notice goes out per week because the notice is keyed on the grant
 * (`dedupePrefix`), which the dispatcher's durable transport and the inbox both claim once.
 *
 * Skipped when nothing actually ends: the person has a later referral week stacked after this one,
 * or a paid plan that is still running.
 *
 * ⚠ IT HONOURS UNSUBSCRIBE although it is sent as `system_account`. The category is the account one
 * (it is about access on the account, and it must not hang on an alert toggle), but the notice also
 * says "upgrade", so an address that clicked Unsubscribe gets it in the bell only — and a failed read
 * of that state withholds the email too, the dispatcher's own rule.
 */

const WINDOW_FROM_MS = 12 * 3_600_000
const WINDOW_TO_MS = 36 * 3_600_000
const LIMIT = 200

export type ProWeekReminderPassResult = { ran: true; candidates: number; sent: number; stillCovered: number; failed: number }

export async function runProWeekEndingReminderPass(
  opts: {
    db?: typeof prisma
    now?: Date
    notify?: typeof dispatchNotification
    readSubscription?: (email: string | null | undefined) => Promise<EmailSubscriptionState>
  } = {},
): Promise<ProWeekReminderPassResult> {
  const db = opts.db ?? prisma
  const now = opts.now ?? new Date()
  const notify = opts.notify ?? dispatchNotification
  const readSubscription = opts.readSubscription ?? readEmailSubscription
  const result: ProWeekReminderPassResult = { ran: true, candidates: 0, sent: 0, stillCovered: 0, failed: 0 }

  const ending = await db.adminSubscriptionGrant.findMany({
    where: {
      reason: { in: [...PRO_WEEK_REASONS] },
      revokedAt: null,
      expiresAt: { gte: new Date(now.getTime() + WINDOW_FROM_MS), lte: new Date(now.getTime() + WINDOW_TO_MS) },
    },
    orderBy: { expiresAt: 'asc' },
    take: LIMIT,
    select: { id: true, userId: true, expiresAt: true },
  })
  result.candidates = ending.length

  for (const grant of ending) {
    try {
      const [later, paid] = await Promise.all([
        db.adminSubscriptionGrant.count({ where: { userId: grant.userId, revokedAt: null, expiresAt: { gt: grant.expiresAt } } }),
        db.userSubscription.count({
          where: { userId: grant.userId, status: { in: ['active', 'trialing', 'past_due', 'grace'] }, currentPeriodEnd: { gt: grant.expiresAt } },
        }),
      ])
      if (later > 0 || paid > 0) {
        result.stillCovered++
        continue
      }
      const user = await db.appUser.findUnique({ where: { id: grant.userId }, select: { email: true } })
      // Any non-exempt category name gives the alert rule: unsubscribed or unreadable → no email.
      const withholdEmail = emailWithheldByUnsubscribe(await readSubscription(user?.email ?? null), 'referral_pro_week_ending')
      const notice = proWeekEndingNotice(formatProWeekEnd(grant.expiresAt))
      await notify({
        userIds: [grant.userId],
        category: 'system_account',
        productType: 'app',
        type: 'referral_pro_week_ending',
        title: notice.title,
        body: notice.body,
        actionHref: '/pricing?from=referral_week_ending',
        actionLabel: 'Keep AF Pro',
        severity: 'medium',
        dedupePrefix: `referral-pro-week-ending:${grant.id}`,
        skipChannels: { sms: true, ...(withholdEmail ? { email: true } : {}) },
      })
      result.sent++
    } catch {
      result.failed++
    }
  }
  return result
}
