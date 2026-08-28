/**
 * Admin — API Usage Rollups
 * GET /api/admin/usage
 *
 * Backs UsageAnalyticsPanel.tsx. Reads pre-aggregated `ApiUsageRollup` rows
 * (written by lib/telemetry/usage.ts's withApiUsage wrapper on live routes).
 * Admin-only endpoint.
 *
 * Query params:
 *   bucketType — "hour" | "day" | "week" | "month" (default: "day")
 *   days       — lookback window in days (default: 30)
 *   scope      — "api" | "legacy_tool" (optional exact filter)
 *   endpoint   — exact endpoint filter
 *   tool       — exact tool filter
 *   leagueId   — exact league filter
 */
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { requireAdmin } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_ROWS = 2000

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const url = new URL(request.url)
  const bucketType = url.searchParams.get("bucketType") ?? "day"
  const days = Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30)
  const scope = url.searchParams.get("scope")
  const endpoint = url.searchParams.get("endpoint")
  const tool = url.searchParams.get("tool")
  const leagueId = url.searchParams.get("leagueId")

  const where: Prisma.ApiUsageRollupWhereInput = {
    bucketType,
    bucketStart: { gte: new Date(Date.now() - days * 86400000) },
  }
  if (scope) where.scope = scope
  if (endpoint) where.endpoint = endpoint
  if (tool) where.tool = tool
  if (leagueId) where.leagueId = leagueId

  try {
    const desc = await prisma.apiUsageRollup.findMany({
      where,
      orderBy: { bucketStart: "desc" },
      take: MAX_ROWS,
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
    })

    const rows = desc
      .slice()
      .reverse()
      .map((r) => ({ ...r, bucketStart: r.bucketStart.toISOString() }))

    return NextResponse.json({ rows })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load usage rollups" },
      { status: 500 },
    )
  }
}
