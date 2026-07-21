/**
 * Admin — API Usage Summary
 * GET /api/admin/usage/summary
 *
 * Backs UsageAnalyticsPanel.tsx. Aggregates `ApiUsageRollup` into totals plus
 * top-N breakdowns by endpoint, tool, and league. Admin-only endpoint.
 *
 * Query params: same as /api/admin/usage, plus
 *   topN — rows per breakdown list (default: 8)
 */
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { requireAdmin } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type TopRow = { name: string; count: number; err: number; p95: number | null }

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
  const topN = Math.min(50, Math.max(1, parseInt(url.searchParams.get("topN") ?? "8", 10) || 8))

  const where: Prisma.ApiUsageRollupWhereInput = {
    bucketType,
    bucketStart: { gte: new Date(Date.now() - days * 86400000) },
  }
  if (scope) where.scope = scope
  if (endpoint) where.endpoint = endpoint
  if (tool) where.tool = tool
  if (leagueId) where.leagueId = leagueId

  try {
    const [totalAgg, byEndpoint, byTool, byLeague, errByEndpoint] = await Promise.all([
      prisma.apiUsageRollup.aggregate({
        where,
        _sum: { count: true, okCount: true, errCount: true },
        _avg: { avgMs: true },
      }),
      prisma.apiUsageRollup.groupBy({
        by: ["endpoint"],
        where: { ...where, endpoint: { not: "" } },
        _sum: { count: true, errCount: true },
        _avg: { p95Ms: true },
        orderBy: { _sum: { count: "desc" } },
        take: topN,
      }),
      prisma.apiUsageRollup.groupBy({
        by: ["tool"],
        where: { ...where, tool: { not: "" } },
        _sum: { count: true, errCount: true },
        _avg: { p95Ms: true },
        orderBy: { _sum: { count: "desc" } },
        take: topN,
      }),
      prisma.apiUsageRollup.groupBy({
        by: ["leagueId"],
        where: { ...where, leagueId: { not: "" } },
        _sum: { count: true, errCount: true },
        _avg: { p95Ms: true },
        orderBy: { _sum: { count: "desc" } },
        take: topN,
      }),
      prisma.apiUsageRollup.groupBy({
        by: ["endpoint"],
        where: { ...where, endpoint: { not: "" } },
        _sum: { count: true, errCount: true },
        _avg: { p95Ms: true },
        orderBy: { _sum: { errCount: "desc" } },
        take: topN,
      }),
    ])

    const count = totalAgg._sum.count ?? 0
    const ok = totalAgg._sum.okCount ?? 0
    const err = totalAgg._sum.errCount ?? 0
    const errRate = count > 0 ? Math.round((err / count) * 1000) / 10 : 0

    const toTopRow = (name: string | null, sum: { count: number | null; errCount: number | null }, avg: { p95Ms: number | null }): TopRow => ({
      name: name || "(unknown)",
      count: sum.count ?? 0,
      err: sum.errCount ?? 0,
      p95: avg.p95Ms ?? null,
    })

    const summary = {
      totals: { count, ok, err, errRate, avgMs: totalAgg._avg.avgMs ?? null },
      topEndpoints: byEndpoint.map((r) => toTopRow(r.endpoint, r._sum, r._avg)),
      topTools: byTool.map((r) => toTopRow(r.tool, r._sum, r._avg)),
      topLeagues: byLeague.map((r) => toTopRow(r.leagueId, r._sum, r._avg)),
      topErrorEndpoints: errByEndpoint
        .filter((r) => (r._sum.errCount ?? 0) > 0)
        .map((r) => toTopRow(r.endpoint, r._sum, r._avg)),
    }

    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load usage summary" },
      { status: 500 },
    )
  }
}
