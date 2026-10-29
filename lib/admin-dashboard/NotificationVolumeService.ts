import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Notification volume — how much we actually send, per person per day, by channel and category.
 * Owner's call, 2026-10-22: "add the numbers tracker to the admin panel and make it actually track
 * the numbers", after complaints about too many pushes and emails.
 *
 * SOURCES, all already written by the send path:
 *   notification_outbox     one row per push / email (deliverDurably) and, since 2026-10-22, per text
 *                           (NotificationDispatcher records each sent SMS as a `sent` row). `status`
 *                           'sent' is a real hand-off to Apple/Google/the browser, Resend or Twilio.
 *                           Category rides in `metadata.notificationCategory` — there is no column.
 *   platform_notifications  one row per in-app (bell) alert; `meta.pushBudget = 'held'` marks an alert
 *                           whose phone buzz the hourly budget held back.
 *   EmailPreference         `unsubscribedAt` — the latest unsubscribe per address (no history table).
 *   user_profiles           `notificationPreferences` — master switch off, live alert level, SMS consent.
 *
 * ⚠ SMS BEFORE 2026-10-22 WAS NEVER LOGGED, so a window reaching back past that undercounts texts.
 * Read-only; every query is bounded by `days` (1-30).
 */

export type ChannelDay = { day: string; push: number; email: number; sms: number; inApp: number; heldPush: number }
export type CategoryRow = { category: string; push: number; email: number; sms: number; users: number }
export type TypeRow = { type: string; channel: string; sent: number; users: number }
export type PerUserStats = { channel: string; userDays: number; avg: number; p50: number; p90: number; max: number; over20: number }
export type TopUser = { userId: string; email: string | null; push: number; email_: number; sms: number; total: number }
export type OptOuts = {
  masterSwitchOff: number
  liveLevels: Record<string, number>
  emailUnsubscribedTotal: number
  emailUnsubscribedInWindow: number
  smsConsentRevoked: number
  profiles: number
}
export type NotificationVolume = {
  days: number
  since: string
  totals: { push: number; email: number; sms: number; inApp: number; heldPush: number; failed: number; recipients: number }
  daily: ChannelDay[]
  categories: CategoryRow[]
  types: TypeRow[]
  perUser: PerUserStats[]
  topUsers: TopUser[]
  optOuts: OptOuts
}

const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0) || 0)
const round = (v: unknown) => Math.round(n(v) * 10) / 10

export async function getNotificationVolume(input: { days?: number; now?: Date } = {}): Promise<NotificationVolume> {
  const days = Math.min(30, Math.max(1, Math.floor(input.days ?? 7)))
  const now = input.now ?? new Date()
  const since = new Date(now.getTime() - days * 86_400_000)
  const sent = Prisma.sql`status = 'sent' AND "sentAt" >= ${since}`

  const [daily, inAppDaily, categories, types, perUser, topUsers, failed, recipients, optOutRows, unsubTotal, unsubWindow] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; channel: string; c: bigint }>>`
      SELECT date_trunc('day', "sentAt") AS day, channel, count(*) AS c
      FROM notification_outbox WHERE ${sent} GROUP BY 1, 2 ORDER BY 1`,
    prisma.$queryRaw<Array<{ day: Date; c: bigint; held: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, count(*) AS c,
        count(*) FILTER (WHERE meta->>'pushBudget' = 'held') AS held
      FROM platform_notifications WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ category: string | null; channel: string; c: bigint; users: bigint }>>`
      SELECT metadata->>'notificationCategory' AS category, channel, count(*) AS c, count(DISTINCT "userId") AS users
      FROM notification_outbox WHERE ${sent} GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ type: string; channel: string; c: bigint; users: bigint }>>`
      SELECT "eventType" AS type, channel, count(*) AS c, count(DISTINCT "userId") AS users
      FROM notification_outbox WHERE ${sent} GROUP BY 1, 2 ORDER BY c DESC LIMIT 30`,
    prisma.$queryRaw<Array<{ channel: string; user_days: bigint; avg: number; p50: number; p90: number; max: bigint; over20: bigint }>>`
      WITH per AS (
        SELECT "userId", channel, date_trunc('day', "sentAt") AS day, count(*) AS c
        FROM notification_outbox WHERE ${sent} AND "userId" IS NOT NULL GROUP BY 1, 2, 3
      )
      SELECT channel, count(*) AS user_days, avg(c)::float AS avg,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY c)::float AS p50,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY c)::float AS p90,
        max(c) AS max, count(*) FILTER (WHERE c >= 20) AS over20
      FROM per GROUP BY channel ORDER BY channel`,
    prisma.$queryRaw<Array<{ userId: string; email: string | null; push: bigint; email_: bigint; sms: bigint; total: bigint }>>`
      SELECT o."userId", u.email,
        count(*) FILTER (WHERE o.channel = 'push') AS push,
        count(*) FILTER (WHERE o.channel = 'email') AS email_,
        count(*) FILTER (WHERE o.channel = 'sms') AS sms,
        count(*) AS total
      FROM notification_outbox o LEFT JOIN app_users u ON u.id = o."userId"
      WHERE o.status = 'sent' AND o."sentAt" >= ${new Date(now.getTime() - 86_400_000)} AND o."userId" IS NOT NULL
      GROUP BY 1, 2 ORDER BY total DESC LIMIT 15`,
    prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT count(*) AS c FROM notification_outbox WHERE status = 'failed' AND "updatedAt" >= ${since}`,
    prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT count(DISTINCT "userId") AS c FROM notification_outbox WHERE ${sent}`,
    prisma.$queryRaw<Array<{ level: string | null; c: bigint; master_off: bigint; sms_revoked: bigint }>>`
      SELECT coalesce("notificationPreferences"->>'liveAlertLevel', 'everything') AS level, count(*) AS c,
        count(*) FILTER (WHERE "notificationPreferences"->>'globalEnabled' = 'false') AS master_off,
        count(*) FILTER (WHERE "notificationPreferences"->'smsConsent'->>'revokedAt' IS NOT NULL) AS sms_revoked
      FROM user_profiles GROUP BY 1`,
    prisma.emailPreference.count({ where: { unsubscribedAt: { not: null } } }),
    prisma.emailPreference.count({ where: { unsubscribedAt: { gte: since } } }),
  ])

  const byDay = new Map<string, ChannelDay>()
  const dayRow = (d: Date) => {
    const key = d.toISOString().slice(0, 10)
    const row = byDay.get(key) ?? { day: key, push: 0, email: 0, sms: 0, inApp: 0, heldPush: 0 }
    byDay.set(key, row)
    return row
  }
  for (const r of daily) {
    const row = dayRow(r.day)
    if (r.channel === 'push' || r.channel === 'email' || r.channel === 'sms') row[r.channel] += n(r.c)
  }
  for (const r of inAppDaily) { const row = dayRow(r.day); row.inApp += n(r.c); row.heldPush += n(r.held) }
  const dailyRows = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))

  const cats = new Map<string, CategoryRow>()
  for (const r of categories) {
    const key = r.category ?? '(uncategorised)'
    const row = cats.get(key) ?? { category: key, push: 0, email: 0, sms: 0, users: 0 }
    if (r.channel === 'push' || r.channel === 'email' || r.channel === 'sms') row[r.channel] += n(r.c)
    row.users = Math.max(row.users, n(r.users))
    cats.set(key, row)
  }

  const liveLevels: Record<string, number> = {}
  let profiles = 0, masterOff = 0, smsRevoked = 0
  for (const r of optOutRows) {
    liveLevels[r.level ?? 'everything'] = n(r.c)
    profiles += n(r.c); masterOff += n(r.master_off); smsRevoked += n(r.sms_revoked)
  }

  const sum = (k: keyof ChannelDay) => dailyRows.reduce((a, r) => a + (r[k] as number), 0)
  return {
    days,
    since: since.toISOString(),
    totals: { push: sum('push'), email: sum('email'), sms: sum('sms'), inApp: sum('inApp'), heldPush: sum('heldPush'), failed: n(failed[0]?.c), recipients: n(recipients[0]?.c) },
    daily: dailyRows,
    categories: [...cats.values()].sort((a, b) => b.push + b.email + b.sms - (a.push + a.email + a.sms)),
    types: types.map(r => ({ type: r.type, channel: r.channel, sent: n(r.c), users: n(r.users) })),
    perUser: perUser.map(r => ({ channel: r.channel, userDays: n(r.user_days), avg: round(r.avg), p50: round(r.p50), p90: round(r.p90), max: n(r.max), over20: n(r.over20) })),
    topUsers: topUsers.map(r => ({ userId: r.userId, email: r.email, push: n(r.push), email_: n(r.email_), sms: n(r.sms), total: n(r.total) })),
    optOuts: {
      profiles,
      masterSwitchOff: masterOff,
      smsConsentRevoked: smsRevoked,
      liveLevels,
      emailUnsubscribedTotal: unsubTotal,
      emailUnsubscribedInWindow: unsubWindow,
    },
  }
}
