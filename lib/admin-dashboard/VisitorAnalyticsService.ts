import "server-only"

import { prisma } from "@/lib/prisma"

/**
 * VisitorAnalyticsService
 * ------------------------------------------------------------------
 * Powers the admin traffic charts + globe.
 *
 * Data sources (in priority order):
 *   1. SiteVisit  — per-hit log keyed by a HASHED ip (privacy-safe). Gives TRUE
 *      unique-IP vs total-visit counts for any time window. Preferred once the
 *      table exists + the write is wired (see docs/admin/VISITOR_ANALYTICS_AND_API_HEALTH.md).
 *   2. AnalyticsEvent — per-event rows (sessionId + createdAt, no IP). Used as a
 *      fallback time series (unique = distinct session, total = event count).
 *   3. VisitorLocation — one cumulative row per unique IP (has lat/lng). Always
 *      used for the GLOBE + all-time totals; also a coarse per-window fallback
 *      via firstSeen (new uniques) / lastSeen (active uniques).
 *
 * Everything is wrapped so a missing table / cold DB never throws into the admin
 * page — each section degrades to empty + a labelled `source`.
 */

export type VisitorWindowKey = "6h" | "12h" | "24h" | "7d" | "1mo" | "6mo" | "12mo"

export type VisitorSource = "site_visit" | "analytics_event" | "visitor_location" | "none"

export type WindowSummary = {
  key: VisitorWindowKey
  label: string
  totalVisits: number
  uniqueVisitors: number
  newVisitors: number
}

export type SeriesPoint = {
  bucket: string // ISO timestamp for the bucket start
  label: string // human label for the x-axis
  total: number
  unique: number
}

export type GlobePoint = {
  lat: number
  lng: number
  city: string | null
  country: string | null
  countryCode: string | null
  visits: number
}

export type CountryRollup = {
  country: string
  countryCode: string | null
  visits: number
  visitors: number
}

export type VisitorAnalytics = {
  generatedAt: string
  summarySource: VisitorSource
  seriesSource: VisitorSource
  geoSource: VisitorSource
  selectedWindow: VisitorWindowKey
  allTimeUniqueVisitors: number
  allTimeVisits: number
  windows: WindowSummary[]
  series: SeriesPoint[]
  globe: GlobePoint[]
  countries: CountryRollup[]
  notes: string[]
}

const WINDOW_CONFIG: Record<
  VisitorWindowKey,
  { label: string; ms: number; granularity: "hour" | "day" | "week" | "month"; buckets: number }
> = {
  "6h": { label: "6 hours", ms: 6 * 3_600_000, granularity: "hour", buckets: 6 },
  "12h": { label: "12 hours", ms: 12 * 3_600_000, granularity: "hour", buckets: 12 },
  "24h": { label: "24 hours", ms: 24 * 3_600_000, granularity: "hour", buckets: 24 },
  "7d": { label: "7 days", ms: 7 * 86_400_000, granularity: "day", buckets: 7 },
  "1mo": { label: "1 month", ms: 30 * 86_400_000, granularity: "day", buckets: 30 },
  "6mo": { label: "6 months", ms: 182 * 86_400_000, granularity: "week", buckets: 26 },
  "12mo": { label: "12 months", ms: 365 * 86_400_000, granularity: "month", buckets: 12 },
}

export const VISITOR_WINDOW_KEYS = Object.keys(WINDOW_CONFIG) as VisitorWindowKey[]

function isValidWindow(value: string | null | undefined): value is VisitorWindowKey {
  return !!value && (VISITOR_WINDOW_KEYS as string[]).includes(value)
}

// Cache the "does SiteVisit exist?" probe for the lifetime of the server process.
let siteVisitAvailable: boolean | null = null
async function hasSiteVisitTable(): Promise<boolean> {
  if (siteVisitAvailable !== null) return siteVisitAvailable
  try {
    // Cheap existence probe; errors if the model/table isn't migrated yet.
    await prisma.$queryRawUnsafe(`SELECT 1 FROM "SiteVisit" LIMIT 1`)
    siteVisitAvailable = true
  } catch {
    siteVisitAvailable = false
  }
  return siteVisitAvailable
}

function truncSql(granularity: "hour" | "day" | "week" | "month") {
  // granularity is from a fixed whitelist above — safe to inline.
  return `date_trunc('${granularity}', "createdAt")`
}

function bucketLabel(date: Date, granularity: "hour" | "day" | "week" | "month"): string {
  const tz = "America/New_York"
  if (granularity === "hour") {
    return date.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: true, month: "short", day: "numeric" })
  }
  if (granularity === "month") {
    return date.toLocaleString("en-US", { timeZone: tz, month: "short", year: "2-digit" })
  }
  return date.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric" })
}

/** Zero-fill a raw {bucket,total,unique} set into an ordered, gap-free series. */
function fillSeries(
  rows: Array<{ bucket: Date; total: number; unique: number }>,
  since: Date,
  cfg: { granularity: "hour" | "day" | "week" | "month"; buckets: number },
): SeriesPoint[] {
  const map = new Map<string, { total: number; unique: number }>()
  for (const r of rows) {
    map.set(new Date(r.bucket).toISOString(), { total: Number(r.total) || 0, unique: Number(r.unique) || 0 })
  }
  const stepMs =
    cfg.granularity === "hour"
      ? 3_600_000
      : cfg.granularity === "day"
        ? 86_400_000
        : cfg.granularity === "week"
          ? 7 * 86_400_000
          : 30 * 86_400_000 // month (approx step for the x-axis grid)

  const out: SeriesPoint[] = []
  // Align the first bucket to the granularity boundary at/after `since`.
  const start = new Date(since)
  for (let i = 0; i < cfg.buckets; i++) {
    const t = new Date(start.getTime() + i * stepMs)
    // Match rows by nearest truncated boundary key (best-effort for month/week drift).
    let hit = map.get(t.toISOString())
    if (!hit) {
      // Fallback: find any row whose bucket falls in [t, t+step)
      for (const [iso, v] of map) {
        const bt = new Date(iso).getTime()
        if (bt >= t.getTime() && bt < t.getTime() + stepMs) {
          hit = v
          break
        }
      }
    }
    out.push({
      bucket: t.toISOString(),
      label: bucketLabel(t, cfg.granularity),
      total: hit?.total ?? 0,
      unique: hit?.unique ?? 0,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Summary cards (all windows)
// ---------------------------------------------------------------------------

async function summariesFromSiteVisit(): Promise<WindowSummary[]> {
  const now = Date.now()
  const results = await Promise.all(
    VISITOR_WINDOW_KEYS.map(async (key) => {
      const cfg = WINDOW_CONFIG[key]
      const since = new Date(now - cfg.ms)
      const rows = await prisma.$queryRawUnsafe<Array<{ total: bigint; unique: bigint }>>(
        `SELECT count(*)::bigint AS total, count(DISTINCT "ipHash")::bigint AS unique
         FROM "SiteVisit" WHERE "createdAt" >= $1`,
        since,
      )
      const total = Number(rows[0]?.total ?? 0)
      const unique = Number(rows[0]?.unique ?? 0)
      // "new" = ipHash whose FIRST-EVER visit landed in this window.
      const newRows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM (
           SELECT "ipHash", min("createdAt") AS first_seen
           FROM "SiteVisit" GROUP BY "ipHash"
         ) t WHERE t.first_seen >= $1`,
        since,
      )
      return {
        key,
        label: cfg.label,
        totalVisits: total,
        uniqueVisitors: unique,
        newVisitors: Number(newRows[0]?.n ?? 0),
      }
    }),
  )
  return results
}

async function summariesFromFallback(): Promise<WindowSummary[]> {
  const now = Date.now()
  return Promise.all(
    VISITOR_WINDOW_KEYS.map(async (key) => {
      const cfg = WINDOW_CONFIG[key]
      const since = new Date(now - cfg.ms)
      let totalVisits = 0
      let uniqueVisitors = 0
      let newVisitors = 0

      // Total + unique(session) from AnalyticsEvent.
      try {
        const agg = await prisma.$queryRawUnsafe<Array<{ total: bigint; unique: bigint }>>(
          `SELECT count(*)::bigint AS total, count(DISTINCT "sessionId")::bigint AS unique
           FROM "AnalyticsEvent" WHERE "createdAt" >= $1`,
          since,
        )
        totalVisits = Number(agg[0]?.total ?? 0)
        uniqueVisitors = Number(agg[0]?.unique ?? 0)
      } catch {
        /* AnalyticsEvent unavailable */
      }

      // New unique IPs (first ever seen in window) from VisitorLocation.firstSeen.
      try {
        newVisitors = await prisma.visitorLocation.count({ where: { firstSeen: { gte: since } } })
        if (uniqueVisitors === 0) {
          // If we have no session data at all, approximate active uniques by lastSeen.
          uniqueVisitors = await prisma.visitorLocation.count({ where: { lastSeen: { gte: since } } })
        }
      } catch {
        /* VisitorLocation unavailable */
      }

      return { key, label: cfg.label, totalVisits, uniqueVisitors, newVisitors }
    }),
  )
}

// ---------------------------------------------------------------------------
// Time series (selected window)
// ---------------------------------------------------------------------------

async function seriesFromSiteVisit(window: VisitorWindowKey): Promise<SeriesPoint[]> {
  const cfg = WINDOW_CONFIG[window]
  const since = new Date(Date.now() - cfg.ms)
  const rows = await prisma.$queryRawUnsafe<Array<{ bucket: Date; total: bigint; unique: bigint }>>(
    `SELECT ${truncSql(cfg.granularity)} AS bucket,
            count(*)::bigint AS total,
            count(DISTINCT "ipHash")::bigint AS unique
     FROM "SiteVisit"
     WHERE "createdAt" >= $1
     GROUP BY 1 ORDER BY 1`,
    since,
  )
  return fillSeries(
    rows.map((r) => ({ bucket: new Date(r.bucket), total: Number(r.total), unique: Number(r.unique) })),
    since,
    cfg,
  )
}

async function seriesFromAnalyticsEvent(window: VisitorWindowKey): Promise<SeriesPoint[]> {
  const cfg = WINDOW_CONFIG[window]
  const since = new Date(Date.now() - cfg.ms)
  const rows = await prisma.$queryRawUnsafe<Array<{ bucket: Date; total: bigint; unique: bigint }>>(
    `SELECT ${truncSql(cfg.granularity)} AS bucket,
            count(*)::bigint AS total,
            count(DISTINCT "sessionId")::bigint AS unique
     FROM "AnalyticsEvent"
     WHERE "createdAt" >= $1
     GROUP BY 1 ORDER BY 1`,
    since,
  )
  return fillSeries(
    rows.map((r) => ({ bucket: new Date(r.bucket), total: Number(r.total), unique: Number(r.unique) })),
    since,
    cfg,
  )
}

// ---------------------------------------------------------------------------
// Globe + country rollup (always from VisitorLocation — it has lat/lng)
// ---------------------------------------------------------------------------

async function getGlobe(): Promise<{ globe: GlobePoint[]; countries: CountryRollup[]; source: VisitorSource }> {
  try {
    const points = await prisma.visitorLocation.findMany({
      where: { lat: { not: null }, lng: { not: null } },
      select: { lat: true, lng: true, city: true, country: true, countryCode: true, visits: true },
      orderBy: { visits: "desc" },
      take: 500,
    })
    const globe: GlobePoint[] = points
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({
        lat: p.lat as number,
        lng: p.lng as number,
        city: p.city,
        country: p.country,
        countryCode: p.countryCode,
        visits: p.visits,
      }))

    const grouped = await prisma.visitorLocation.groupBy({
      by: ["country", "countryCode"],
      _sum: { visits: true },
      _count: { _all: true },
      orderBy: { _sum: { visits: "desc" } },
      take: 20,
    })
    const countries: CountryRollup[] = grouped.map((g) => ({
      country: g.country ?? "Unknown",
      countryCode: g.countryCode,
      visits: g._sum.visits ?? 0,
      visitors: g._count._all,
    }))

    return { globe, countries, source: globe.length ? "visitor_location" : "none" }
  } catch {
    return { globe: [], countries: [], source: "none" }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function getVisitorAnalytics(windowInput?: string | null): Promise<VisitorAnalytics> {
  const selectedWindow: VisitorWindowKey = isValidWindow(windowInput) ? windowInput : "24h"
  const notes: string[] = []
  const useSiteVisit = await hasSiteVisitTable()

  // Summaries
  let windows: WindowSummary[] = []
  let summarySource: VisitorSource = "none"
  let seriesSource: VisitorSource = "none"
  let series: SeriesPoint[] = []

  if (useSiteVisit) {
    try {
      windows = await summariesFromSiteVisit()
      summarySource = "site_visit"
      series = await seriesFromSiteVisit(selectedWindow)
      seriesSource = "site_visit"
    } catch {
      notes.push("SiteVisit query failed; fell back to analytics/session data.")
    }
  }

  if (summarySource === "none") {
    windows = await summariesFromFallback()
    summarySource = windows.some((w) => w.totalVisits > 0 || w.uniqueVisitors > 0)
      ? "analytics_event"
      : "visitor_location"
    notes.push(
      "Showing session/location-based estimates. Enable the SiteVisit log (see wiring guide) for true unique-IP vs total-visit counts per window.",
    )
  }

  if (seriesSource === "none") {
    try {
      series = await seriesFromAnalyticsEvent(selectedWindow)
      seriesSource = series.some((p) => p.total > 0) ? "analytics_event" : "none"
    } catch {
      series = []
    }
  }

  // All-time totals + globe from VisitorLocation
  let allTimeUniqueVisitors = 0
  let allTimeVisits = 0
  try {
    allTimeUniqueVisitors = await prisma.visitorLocation.count()
    const sum = await prisma.visitorLocation.aggregate({ _sum: { visits: true } })
    allTimeVisits = sum._sum.visits ?? 0
  } catch {
    /* ignore */
  }

  const { globe, countries, source: geoSource } = await getGlobe()

  if (geoSource === "none") {
    notes.push("No geolocated visitors yet. VisitorLocation fills in as /api/track-visitor records IPs with lat/lng.")
  }

  return {
    generatedAt: new Date().toISOString(),
    summarySource,
    seriesSource,
    geoSource,
    selectedWindow,
    allTimeUniqueVisitors,
    allTimeVisits,
    windows,
    series,
    globe,
    countries,
    notes,
  }
}
