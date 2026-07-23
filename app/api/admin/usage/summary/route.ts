import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/adminAuth"
import { withApiUsage } from "@/lib/telemetry/usage"

export const dynamic = "force-dynamic"

const BUCKET_TYPES = ["hour", "day", "week", "month"] as const
type BucketType = (typeof BUCKET_TYPES)[number]

function parseBucketType(raw: string | null): BucketType {
  return (BUCKET_TYPES as readonly string[]).includes(raw ?? "") ? (raw as BucketType) : "day"
}

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const n = parseInt(raw ?? "", 10)
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max)
}

type TopRow = { name: string; count: number; err: number; p95: number | null }

/**
 * GET: aggregated usage summary for the admin Usage Analytics panel (admin only).
 *
 * Shape is fixed by components/admin/UsageAnalyticsPanel.tsx:
 *   { totals: { count, ok, err, errRate, avgMs }, topEndpoints, topTools, topLeagues, topErrorEndpoints }
 *
 * Admin-gated for the same reason as /api/admin/usage — the original shipped ungated.
 */
export const GET = withApiUsage({ endpoint: "/api/admin/usage/summary", tool: "AdminUsageSummary" })(
  async (req: Request) => {
    const gate = await requireAdmin()
    if (!gate.ok) return gate.res

    const url = new URL(req.url)
    const params = url.searchParams

    const bucketType = parseBucketType(params.get("bucketType"))
    const days = clampInt(params.get("days"), 30, 1, 365)
    const topN = clampInt(params.get("topN"), 8, 1, 100)

    const scope = params.get("scope") || undefined
    const endpoint = params.get("endpoint") || undefined
    const tool = params.get("tool") || undefined
    const leagueId = params.get("leagueId") || undefined

    const since = new Date(Date.now() - days * 24 * 3600 * 1000)

    const rows = await prisma.apiUsageRollup.findMany({
      where: {
        bucketType,
        bucketStart: { gte: since },
        ...(scope ? { scope } : {}),
        ...(endpoint ? { endpoint } : {}),
        ...(tool ? { tool } : {}),
        ...(leagueId ? { leagueId } : {}),
      },
      select: {
        endpoint: true,
        tool: true,
        leagueId: true,
        count: true,
        okCount: true,
        errCount: true,
        avgMs: true,
        p95Ms: true,
        maxMs: true,
      },
    })

    const acc = rows.reduce(
      (a, r) => {
        a.count += r.count ?? 0
        a.ok += r.okCount ?? 0
        a.err += r.errCount ?? 0
        if (r.avgMs != null) {
          a.avgMsSum += Number(r.avgMs)
          a.avgMsN += 1
        }
        return a
      },
      { count: 0, ok: 0, err: 0, avgMsSum: 0, avgMsN: 0 }
    )

    const errRate = acc.count ? Math.round((acc.err / acc.count) * 1000) / 10 : 0
    const avgMs = acc.avgMsN ? Math.round(acc.avgMsSum / acc.avgMsN) : null

    // Only the five fields the panel's `Summary["totals"]` type declares — the
    // avgMsSum/avgMsN running accumulators stay internal.
    const totals = { count: acc.count, ok: acc.ok, err: acc.err, errRate, avgMs }

    /** Full aggregation for one grouping key — callers decide how to rank and truncate. */
    function aggregateBy(key: "endpoint" | "tool" | "leagueId"): TopRow[] {
      const m = new Map<string, { count: number; err: number; p95: number | null }>()
      for (const r of rows) {
        const raw = r[key]
        const name = !raw ? "(none)" : raw
        const cur = m.get(name) ?? { count: 0, err: 0, p95: null as number | null }
        cur.count += r.count ?? 0
        cur.err += r.errCount ?? 0
        const p95 = r.p95Ms == null ? null : Number(r.p95Ms)
        if (p95 != null) cur.p95 = Math.max(cur.p95 ?? 0, p95)
        m.set(name, cur)
      }
      return [...m.entries()].map(([name, v]) => ({ name, ...v }))
    }

    const byCount = (a: TopRow, b: TopRow) => b.count - a.count
    const endpoints = aggregateBy("endpoint")

    const topEndpoints = [...endpoints].sort(byCount).slice(0, topN)
    const topTools = aggregateBy("tool").sort(byCount).slice(0, topN)
    const topLeagues = aggregateBy("leagueId").sort(byCount).slice(0, topN)

    // Ranked over every endpoint, not just the top-N by volume: a low-traffic
    // endpoint failing every call is exactly what this card exists to surface,
    // and it would never appear if we re-sorted an already-truncated list.
    const topErrorEndpoints = [...endpoints].sort((a, b) => b.err - a.err).slice(0, topN)

    return NextResponse.json({
      bucketType,
      days,
      since,
      totals,
      topEndpoints,
      topTools,
      topLeagues,
      topErrorEndpoints,
    })
  }
)
