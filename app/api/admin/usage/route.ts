import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/adminAuth"
import { withApiUsage } from "@/lib/telemetry/usage"

export const dynamic = "force-dynamic"

// The panel renders the last 80 buckets; cap well above that rather than
// streaming an unbounded result set (365 days of hourly buckets is ~8.7k).
const MAX_ROWS = 5000

const BUCKET_TYPES = ["hour", "day", "week", "month"] as const
type BucketType = (typeof BUCKET_TYPES)[number]

function parseBucketType(raw: string | null): BucketType {
  return (BUCKET_TYPES as readonly string[]).includes(raw ?? "") ? (raw as BucketType) : "day"
}

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const n = parseInt(raw ?? "", 10)
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max)
}

/**
 * GET: raw ApiUsageRollup buckets for the admin Usage Analytics panel (admin only).
 *
 * The original of this route shipped ungated (see docs/PROMPT288_SECURITY_AUDIT_DELIVERABLE.md);
 * it exposes per-league traffic volumes, error rates and latency, so it is admin-gated here.
 * The gate runs before any query so an unauthorized caller never reaches the database.
 */
export const GET = withApiUsage({ endpoint: "/api/admin/usage", tool: "AdminUsage" })(
  async (req: Request) => {
    const gate = await requireAdmin()
    if (!gate.ok) return gate.res

    const url = new URL(req.url)
    const params = url.searchParams

    const bucketType = parseBucketType(params.get("bucketType"))
    // Clamped so a hand-edited `days` cannot turn this into a full-table scan.
    const days = clampInt(params.get("days"), 30, 1, 365)

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
      // Explicit select, matching RollupRow in components/admin/UsageAnalyticsPanel.tsx.
      // This is load-bearing, not tidiness: ApiUsageRollup.id, .bytesInSum and
      // .bytesOutSum are BigInt columns, and NextResponse.json -> JSON.stringify
      // throws "Do not know how to serialize a BigInt". A bare findMany() returns
      // all three and 500s on every call.
      select: {
        bucketStart: true,
        bucketType: true,
        scope: true,
        tool: true,
        endpoint: true,
        leagueId: true,
        count: true,
        okCount: true,
        errCount: true,
        avgMs: true,
        p95Ms: true,
        maxMs: true,
      },
      // Newest-first + take, then reversed below. Ordering ascending here would
      // make the cap return the OLDEST rows, and the panel renders rows.slice(-80),
      // so an over-cap range would silently show stale buckets as if current.
      orderBy: [{ bucketStart: "desc" }],
      take: MAX_ROWS,
    })

    // Panel expects chronological order.
    rows.reverse()

    return NextResponse.json({ bucketType, days, rows, truncated: rows.length === MAX_ROWS })
  }
)
