import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ANALYTICS_TOOL_PRODUCT } from '@/lib/analytics/eventNames'
import { HIGHLIGHTS, HIGHLIGHT_SURFACES } from './highlights'
import type { HighlightSurface } from './highlights'

export type HighlightSurfaceReport = {
  surface: HighlightSurface; views: number; users: number; withClips: number; empty: number;
  unavailable: number; errors: number; loadViews: number; readyViews: number; failedViews: number; sourceViews: number;
  availabilityRate: number | null; loadRate: number | null; embedSuccessRate: number | null;
}
export type HighlightReport = {
  from: string; until: string; lastEventAt: string | null; timezone: 'America/New_York';
  surfaces: HighlightSurfaceReport[];
  returns: { cohort: number; matured: number; pending: number; returned: number; scheduledDays: number; rate: number | null;
    status: 'no_data' | 'pending' | 'schedule_unavailable' | 'measured' };
}
type Counts = Omit<HighlightSurfaceReport, 'surface' | 'availabilityRate' | 'loadRate' | 'embedSuccessRate'>
type SurfaceRow = { surface: string; lastEventAt: Date | null } & { [K in keyof Counts]: bigint }
const ratio = (n: number, d: number) => d > 0 ? n / d : null

/** Aggregates only. Bounded, explicit event names use the existing (event, createdAt) index. */
export async function getHighlightReport(now = new Date(), db: Pick<typeof prisma, '$queryRaw'> = prisma): Promise<HighlightReport> {
  // Prisma DateTime columns are UTC timestamp-without-time-zone; convert UTC -> ET explicitly.
  const since = new Date(now.getTime() - 28 * 86400000)
  const cte = Prisma.sql`
    WITH events AS (
      SELECT "event", "userId", "meta", "createdAt"
      FROM "AnalyticsEvent"
      WHERE "event" IN (${Prisma.join(Object.values(HIGHLIGHTS))})
        AND "toolKey" = ${ANALYTICS_TOOL_PRODUCT} AND "userId" IS NOT NULL
        AND "createdAt" >= ${since} AND "createdAt" <= ${now}
        AND "meta"->>'surface' IN (${Prisma.join(HIGHLIGHT_SURFACES)})
        AND "meta"->>'viewId' IS NOT NULL
    ), views AS (
      SELECT DISTINCT ON ("userId", "meta"->>'viewId')
        "userId", "meta"->>'viewId' AS view_id, "meta"->>'surface' AS surface,
        "meta"->>'status' AS status, "createdAt" AS seen_at
      FROM events WHERE "event" = ${HIGHLIGHTS.VIEW}
      ORDER BY "userId", "meta"->>'viewId', "createdAt" ASC
    )`
  const [surfaces, returns] = await Promise.all([
    db.$queryRaw<SurfaceRow[]>(Prisma.sql`${cte}, actions AS (
      SELECT "userId", "meta"->>'viewId' AS view_id, "meta"->>'surface' AS surface,
        bool_or("event" = ${HIGHLIGHTS.LOAD}) AS loaded,
        bool_or("event" = ${HIGHLIGHTS.READY}) AS ready,
        bool_or("event" = ${HIGHLIGHTS.ERROR}) AS failed,
        bool_or("event" = ${HIGHLIGHTS.SOURCE}) AS source
      FROM events WHERE "event" <> ${HIGHLIGHTS.VIEW} GROUP BY 1, 2, 3
    ) SELECT v.surface, count(*)::bigint AS views, count(DISTINCT v."userId")::bigint AS users,
      count(*) FILTER (WHERE v.status = 'clips')::bigint AS "withClips",
      count(*) FILTER (WHERE v.status = 'empty')::bigint AS empty,
      count(*) FILTER (WHERE v.status = 'unavailable')::bigint AS unavailable,
      count(*) FILTER (WHERE v.status = 'error')::bigint AS errors,
      count(*) FILTER (WHERE v.status = 'clips' AND a.loaded)::bigint AS "loadViews",
      count(*) FILTER (WHERE v.status = 'clips' AND a.loaded AND a.ready)::bigint AS "readyViews",
      count(*) FILTER (WHERE v.status = 'clips' AND a.loaded AND a.failed)::bigint AS "failedViews",
      count(*) FILTER (WHERE v.status = 'clips' AND a.source)::bigint AS "sourceViews",
      max(v.seen_at) AS "lastEventAt"
      FROM views v LEFT JOIN actions a ON a."userId" = v."userId" AND a.view_id = v.view_id AND a.surface = v.surface
      GROUP BY v.surface`),
    db.$queryRaw<Array<{ cohort: bigint; matured: bigint; returned: bigint; scheduledDays: bigint }>>(Prisma.sql`${cte}, firsts AS (
      SELECT "userId", min(seen_at) AS first_at FROM views GROUP BY "userId"
    ), game_days AS (
      SELECT DISTINCT ("startTime" AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date AS day
      FROM "SportsGame" WHERE "sport" = 'NFL'
        AND "startTime" >= ${since} - interval '1 day' AND "startTime" <= ${now} + interval '1 day'
        AND lower(coalesce("status", '')) NOT IN ('cancelled', 'canceled', 'postponed')
    ) SELECT count(*)::bigint AS cohort,
      count(*) FILTER (WHERE f.first_at <= ${now} - interval '7 days')::bigint AS matured,
      count(*) FILTER (WHERE f.first_at <= ${now} - interval '7 days' AND EXISTS (
        SELECT 1 FROM views v WHERE v."userId" = f."userId"
          AND v.seen_at > f.first_at AND v.seen_at <= f.first_at + interval '7 days'
          AND (v.seen_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date > (f.first_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date
          AND (v.seen_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date IN (SELECT day FROM game_days)
      ))::bigint AS returned,
      (SELECT count(*)::bigint FROM game_days WHERE day <= (${now}::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date) AS "scheduledDays"
      FROM firsts f`),
  ])
  const rows = HIGHLIGHT_SURFACES.map(surface => {
    const row = surfaces.find(r => r.surface === surface)
    const counts = Object.fromEntries(['views', 'users', 'withClips', 'empty', 'unavailable', 'errors', 'loadViews', 'readyViews', 'failedViews', 'sourceViews'].map(k => [k, Number(row?.[k as keyof Counts] ?? 0)])) as Counts
    return { surface, ...counts, availabilityRate: ratio(counts.withClips, counts.views), loadRate: ratio(counts.loadViews, counts.withClips), embedSuccessRate: ratio(counts.readyViews, counts.loadViews) }
  })
  const r = returns[0]
  const cohort = Number(r?.cohort ?? 0), matured = Number(r?.matured ?? 0), returned = Number(r?.returned ?? 0), scheduledDays = Number(r?.scheduledDays ?? 0)
  const latest = surfaces.flatMap(s => s.lastEventAt ? [new Date(s.lastEventAt).getTime()] : [])
  const status = !cohort ? 'no_data' : !matured ? 'pending' : !scheduledDays ? 'schedule_unavailable' : 'measured'
  return {
    from: since.toISOString(), until: now.toISOString(), lastEventAt: latest.length ? new Date(Math.max(...latest)).toISOString() : null,
    timezone: 'America/New_York', surfaces: rows,
    returns: { cohort, matured, pending: cohort - matured, returned, scheduledDays, rate: status === 'measured' ? ratio(returned, matured) : null, status },
  }
}
