import 'server-only'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { APP_OPEN_EVENT } from '@/lib/analytics/appOpen'
import {
  buildPlatformRows,
  NEW_USER_LOOKBACK_DAYS,
  normalizeWindow,
  parseDaily,
  parseTotal,
  type AppPlatformReport,
  type Rows,
} from './appPlatformStats'

/**
 * The data behind /admin/apps, read from our own `AnalyticsEvent` "app_open" rows
 * (lib/analytics/appOpen.ts). Read-only, admin-only, no third-party service or key.
 *
 * A person is a device: the `af_anon_id` cookie, or the signed-in user when there is
 * no cookie. `createdAt` is stored in UTC, so days are UTC days.
 *
 * Each query is read on its own; a failed one is REPORTED in `errors` and leaves its
 * section null — never a zero, which here would read as "nobody used the app".
 */

const PERSON = Prisma.raw(`coalesce("sessionId", "userId")`)
const PLATFORM = Prisma.raw(`coalesce(meta->>'app_platform', 'unlabelled')`)
const NOW = Prisma.raw(`(now() AT TIME ZONE 'UTC')`)

export function appPlatformQueries(days: number) {
  const d = normalizeWindow(days)
  const opens = Prisma.sql`event = ${APP_OPEN_EVENT} AND ${PERSON} IS NOT NULL`
  const since = (n: number) => Prisma.sql`"createdAt" >= ${NOW} - make_interval(days => ${n}::int)`
  return {
    total: Prisma.sql`SELECT count(DISTINCT ${PERSON})::int AS n FROM "AnalyticsEvent" WHERE ${opens} AND ${since(d)}`,
    active: Prisma.sql`SELECT ${PLATFORM} AS platform, count(DISTINCT ${PERSON})::int AS users FROM "AnalyticsEvent" WHERE ${opens} AND ${since(d)} GROUP BY 1`,
    daily: Prisma.sql`SELECT to_char("createdAt"::date, 'YYYY-MM-DD') AS day, ${PLATFORM} AS platform, count(DISTINCT ${PERSON})::int AS users FROM "AnalyticsEvent" WHERE ${opens} AND "createdAt" >= date_trunc('day', ${NOW}) - make_interval(days => ${d - 1}::int) GROUP BY 1, 2 ORDER BY 1`,
    newUsers: Prisma.sql`SELECT platform, count(*)::int AS new_users, (count(*) FILTER (WHERE active_days > 1))::int AS came_back FROM (SELECT ${PERSON} AS person, (array_agg(${PLATFORM} ORDER BY "createdAt"))[1] AS platform, min("createdAt") AS first_seen, count(DISTINCT "createdAt"::date) AS active_days FROM "AnalyticsEvent" WHERE ${opens} AND ${since(NEW_USER_LOOKBACK_DAYS)} GROUP BY 1) p WHERE first_seen >= ${NOW} - make_interval(days => ${d}::int) GROUP BY 1`,
    countingSince: Prisma.sql`SELECT min("createdAt") AS first FROM "AnalyticsEvent" WHERE event = ${APP_OPEN_EVENT}`,
  }
}

type Db = Pick<typeof prisma, '$queryRaw'>
type Row = Record<string, unknown>

export async function getAppPlatformReport(opts: { days?: unknown; now?: Date; db?: Db } = {}): Promise<AppPlatformReport> {
  const days = normalizeWindow(opts.days)
  const db = opts.db ?? prisma
  const q = appPlatformQueries(days)
  const errors: string[] = []
  const read = async (name: string, query: Prisma.Sql, cols: string[]): Promise<Rows | null> => {
    try {
      const rows = await db.$queryRaw<Row[]>(query)
      return rows.map((r) => cols.map((c) => r[c]))
    } catch {
      // No error text: a database error can echo query details, and this reaches the page.
      errors.push(`${name}: the database query failed`)
      return null
    }
  }
  const [total, active, daily, newUsers, first] = await Promise.all([
    read('Active people', q.total, ['n']),
    read('Active by platform', q.active, ['platform', 'users']),
    read('Daily chart', q.daily, ['day', 'platform', 'users']),
    read('New people', q.newUsers, ['platform', 'new_users', 'came_back']),
    read('Counting start', q.countingSince, ['first']),
  ])
  const firstAt = first?.[0]?.[0]
  return {
    days,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    totalActive: total ? parseTotal(total) : null,
    countingSince: firstAt instanceof Date ? firstAt.toISOString() : typeof firstAt === 'string' ? firstAt : null,
    platforms: buildPlatformRows(active, newUsers),
    daily: daily ? parseDaily(daily) : null,
    errors,
  }
}
