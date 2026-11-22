import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import {
  formatProWeekEnd,
  friendProWeekNotice,
  PRO_WEEK_CLAIM_KEY,
  PRO_WEEK_GRANTED_BY,
  PRO_WEEK_REASON_FRIEND,
  PRO_WEEK_REASON_REFERRER,
  PRO_WEEK_REASONS,
  proWeekDaysFromEnv,
  proWeekPersonName,
  proWeekWindow,
  referrerCapReached,
  referrerCappedNotice,
  referrerProWeekNotice,
  referrerWindowStart,
} from './proWeek'

/**
 * Hands out "give a week, get a week" (rules in `./proWeek.ts`) when a referred friend imports a
 * league. Called fire-and-forget from the import commit route, after the import has succeeded.
 *
 * ⚠ ONCE PER FRIEND, AND RACE-SAFE. A friend importing two leagues at once fires this twice. The claim
 * is a conditional UPDATE on the referral row (`metadata.proWeekClaimedAt` must be absent), inside the
 * same transaction as both grants — so exactly one run wins, and a grant that fails rolls the claim
 * back instead of leaving a friend marked "rewarded" with nothing to show for it.
 *
 * ⚠ THE REFERRER CAP IS COUNTED UNDER A LOCK. Two different friends importing in the same second would
 * otherwise both read "3 of 4" and both grant. `pg_advisory_xact_lock` on the referrer serialises the
 * count-then-grant, and is released with the transaction.
 *
 * NEVER THROWS. The import already happened; a reward failure is logged, never surfaced.
 */

export type ProWeekAwardResult =
  | { awarded: false; reason: 'disabled' | 'not_referred' | 'already_claimed' | 'self_referral' | 'error' }
  | { awarded: true; days: number; friendGrantId: string; referrerGrantId: string | null; referrerCapped: boolean }

type Db = typeof prisma

async function latestRunningProWeekExpiry(tx: Pick<Db, 'adminSubscriptionGrant'>, userId: string, now: Date): Promise<Date | null> {
  const row = await tx.adminSubscriptionGrant.findFirst({
    where: { userId, reason: { in: [...PRO_WEEK_REASONS] }, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
    select: { expiresAt: true },
  })
  return row?.expiresAt ?? null
}

export async function awardReferralProWeekOnImport(
  friendUserId: string,
  opts: { db?: Db; now?: Date; env?: NodeJS.ProcessEnv; notify?: typeof dispatchNotification } = {},
): Promise<ProWeekAwardResult> {
  const db = opts.db ?? prisma
  const now = opts.now ?? new Date()
  const notify = opts.notify ?? dispatchNotification
  try {
    const days = proWeekDaysFromEnv(opts.env ?? process.env)
    if (days <= 0) return { awarded: false, reason: 'disabled' }

    const referral = await db.referral.findFirst({
      where: { referredUserId: friendUserId },
      select: { id: true, referrerId: true },
    })
    if (!referral) return { awarded: false, reason: 'not_referred' }
    if (referral.referrerId === friendUserId) return { awarded: false, reason: 'self_referral' }

    const outcome = await db.$transaction(async (tx) => {
      const claimed = await tx.$executeRaw`
        UPDATE "referrals"
           SET "metadata" = COALESCE("metadata", '{}'::jsonb) || jsonb_build_object(${PRO_WEEK_CLAIM_KEY}::text, ${now.toISOString()}::text),
               "updatedAt" = NOW()
         WHERE "id" = ${referral.id}
           AND ("metadata" IS NULL OR "metadata"->>${PRO_WEEK_CLAIM_KEY}::text IS NULL)`
      if (claimed !== 1) return null

      const friendWindow = proWeekWindow(now, await latestRunningProWeekExpiry(tx, friendUserId, now), days)
      const friendGrant = await tx.adminSubscriptionGrant.create({
        data: {
          userId: friendUserId,
          tier: 'pro',
          startsAt: friendWindow.startsAt,
          expiresAt: friendWindow.expiresAt,
          grantedByAdminId: PRO_WEEK_GRANTED_BY,
          grantedByEmail: PRO_WEEK_GRANTED_BY,
          reason: PRO_WEEK_REASON_FRIEND,
        },
        select: { id: true, expiresAt: true },
      })

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`referral-pro-week:${referral.referrerId}`}))`
      const weeksInWindow = await tx.adminSubscriptionGrant.count({
        where: { userId: referral.referrerId, reason: PRO_WEEK_REASON_REFERRER, createdAt: { gte: referrerWindowStart(now) } },
      })
      let referrerGrant: { id: string; expiresAt: Date } | null = null
      if (!referrerCapReached(weeksInWindow)) {
        const referrerWindow = proWeekWindow(now, await latestRunningProWeekExpiry(tx, referral.referrerId, now), days)
        referrerGrant = await tx.adminSubscriptionGrant.create({
          data: {
            userId: referral.referrerId,
            tier: 'pro',
            startsAt: referrerWindow.startsAt,
            expiresAt: referrerWindow.expiresAt,
            grantedByAdminId: PRO_WEEK_GRANTED_BY,
            grantedByEmail: PRO_WEEK_GRANTED_BY,
            reason: PRO_WEEK_REASON_REFERRER,
          },
          select: { id: true, expiresAt: true },
        })
      }

      await tx.referralEvent.create({
        data: {
          referrerId: referral.referrerId,
          referredUserId: friendUserId,
          referralId: referral.id,
          type: 'pro_week_granted',
          metadata: { days, friendGrantId: friendGrant.id, referrerGrantId: referrerGrant?.id ?? null, referrerCapped: !referrerGrant },
        },
      })
      return { friendGrant, referrerGrant }
    })
    if (!outcome) return { awarded: false, reason: 'already_claimed' }

    // After the commit: a notice that fails never takes a week back.
    const people = await db.appUser
      .findMany({ where: { id: { in: [friendUserId, referral.referrerId] } }, select: { id: true, displayName: true, username: true } })
      .catch(() => [] as Array<{ id: string; displayName: string | null; username: string }>)
    const nameOf = (id: string) => proWeekPersonName(people.find((p) => p.id === id))
    const actionHref = '/core'
    const friendNotice = friendProWeekNotice(nameOf(referral.referrerId), days, formatProWeekEnd(outcome.friendGrant.expiresAt))
    await notify({
      userIds: [friendUserId], category: 'system_account', productType: 'app', type: 'referral_pro_week',
      title: friendNotice.title, body: friendNotice.body, actionHref, actionLabel: 'Open AllFantasy', severity: 'medium',
      dedupePrefix: `referral-pro-week:${outcome.friendGrant.id}`, skipChannels: { sms: true },
    }).catch(() => null)
    if (outcome.referrerGrant) {
      const notice = referrerProWeekNotice(nameOf(friendUserId), days, formatProWeekEnd(outcome.referrerGrant.expiresAt))
      await notify({
        userIds: [referral.referrerId], category: 'system_account', productType: 'app', type: 'referral_pro_week',
        title: notice.title, body: notice.body, actionHref, actionLabel: 'Open AllFantasy', severity: 'medium',
        dedupePrefix: `referral-pro-week:${outcome.referrerGrant.id}`, skipChannels: { sms: true },
      }).catch(() => null)
    } else {
      // Capped: a thank-you in the bell only. An email saying "you got nothing" is not worth sending.
      const notice = referrerCappedNotice(nameOf(friendUserId))
      await notify({
        userIds: [referral.referrerId], category: 'system_account', productType: 'app', type: 'referral_pro_week_capped',
        title: notice.title, body: notice.body, actionHref: '/referral', actionLabel: 'See your referrals', severity: 'low',
        dedupePrefix: `referral-pro-week-capped:${referral.id}`, skipChannels: { sms: true, email: true, push: true },
      }).catch(() => null)
    }

    return {
      awarded: true,
      days,
      friendGrantId: outcome.friendGrant.id,
      referrerGrantId: outcome.referrerGrant?.id ?? null,
      referrerCapped: !outcome.referrerGrant,
    }
  } catch (error) {
    console.warn('[referral-pro-week] award failed for user', friendUserId, error instanceof Error ? error.message : error)
    return { awarded: false, reason: 'error' }
  }
}
