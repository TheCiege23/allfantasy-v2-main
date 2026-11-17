import { MRR_BILLED_STATUSES, MRR_PAID_SOURCES } from '@/lib/monetization/mrrEstimate'
import { PRO_WEEK_REASON_FRIEND, PRO_WEEK_REASONS } from './proWeek'

/**
 * "Give a week, get a week" on the admin dashboard (lib/referral/proWeek.ts): weeks handed out in the
 * last 30 days, how many are running now, and how many people who ever had one went on to PAY — a store
 * subscription started after their first referral week. The last is the figure the offer exists for.
 */

export type ProWeekStats = {
  granted30d: number
  runningNow: number
  peopleWithWeek: number
  convertedToPaid: number
  /** Referred friends who brought a league (imported or joined through an invite) in 30 days: one friend week each. */
  friendsBroughtLeague30d: number
}

type GrantRow = { userId: string; createdAt: Date }
type SubRow = { userId: string; createdAt: Date; status: string | null; source: string | null }

/** PURE: people whose first referral week came before a paid, billed subscription. */
export function countConvertedToPaid(grants: readonly GrantRow[], subs: readonly SubRow[]): { peopleWithWeek: number; convertedToPaid: number } {
  const firstWeek = new Map<string, Date>()
  for (const g of grants) {
    const seen = firstWeek.get(g.userId)
    if (!seen || g.createdAt < seen) firstWeek.set(g.userId, g.createdAt)
  }
  const converted = new Set<string>()
  for (const s of subs) {
    const first = firstWeek.get(s.userId)
    if (!first || s.createdAt <= first) continue
    if (!MRR_BILLED_STATUSES.includes(String(s.status ?? '').toLowerCase())) continue
    if (!MRR_PAID_SOURCES.includes(String(s.source ?? '').toLowerCase())) continue
    converted.add(s.userId)
  }
  return { peopleWithWeek: firstWeek.size, convertedToPaid: converted.size }
}

type StatsDb = {
  adminSubscriptionGrant: {
    count: (args: unknown) => Promise<number>
    findMany: (args: unknown) => Promise<GrantRow[]>
  }
  userSubscription: { findMany: (args: unknown) => Promise<SubRow[]> }
}

const MAX_ROWS = 5000

export async function loadProWeekStats(db: StatsDb, now = new Date()): Promise<ProWeekStats> {
  const reason = { in: [...PRO_WEEK_REASONS] }
  const since = new Date(now.getTime() - 30 * 86_400_000)
  const [granted30d, friendsBroughtLeague30d, runningNow, grants] = await Promise.all([
    db.adminSubscriptionGrant.count({ where: { reason, createdAt: { gte: since } } }),
    db.adminSubscriptionGrant.count({ where: { reason: PRO_WEEK_REASON_FRIEND, createdAt: { gte: since } } }),
    db.adminSubscriptionGrant.count({ where: { reason, revokedAt: null, expiresAt: { gt: now } } }),
    db.adminSubscriptionGrant.findMany({ where: { reason }, select: { userId: true, createdAt: true }, take: MAX_ROWS }),
  ])
  const userIds = [...new Set(grants.map((g) => g.userId))]
  const subs = userIds.length
    ? await db.userSubscription.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, createdAt: true, status: true, source: true },
        take: MAX_ROWS,
      })
    : []
  return { granted30d, friendsBroughtLeague30d, runningNow, ...countConvertedToPaid(grants, subs) }
}

export function describeProWeekStats(s: ProWeekStats): string {
  return `${s.friendsBroughtLeague30d} referred friends brought a league · ${s.runningNow} running now · ${s.convertedToPaid} of ${s.peopleWithWeek} people who had one went on to pay`
}
