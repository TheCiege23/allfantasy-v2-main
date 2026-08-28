/**
 * Admin — AI Outcome Metrics
 * GET /api/admin/ai/metrics
 *
 * Backs AdminAIOutcomeDashboard.tsx. Admin-only endpoint.
 *
 * Query params:
 *   dateFrom, dateTo — YYYY-MM-DD (default: last 30 days)
 *   sport            — sport key or "all"
 *   leagueType       — "dynasty" | "redraft" | "keeper" | "all"
 *   feature          — AIFeatureCategory or "all"
 *   userSegment      — "high" | "medium" | "low" | "all"
 *   timeRange        — "7d" | "30d" | "all" (time-series window)
 */
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { getAdminAIMetricsBundle } from "@/lib/ai/admin/getAIMetrics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const url = new URL(request.url)
  const toParam = url.searchParams.get("dateTo")
  const fromParam = url.searchParams.get("dateFrom")
  const dateTo = toParam ? new Date(toParam) : new Date()
  const dateFrom = fromParam ? new Date(fromParam) : new Date(dateTo.getTime() - 30 * 86400000)

  const sport = url.searchParams.get("sport") ?? "all"
  const leagueType = url.searchParams.get("leagueType") ?? "all"
  const feature = (url.searchParams.get("feature") ?? "all") as
    | "draft"
    | "trade"
    | "waiver"
    | "coaching"
    | "all"
  const userSegment = (url.searchParams.get("userSegment") ?? "all") as
    | "all"
    | "high"
    | "medium"
    | "low"
  const timeRange = (url.searchParams.get("timeRange") ?? "30d") as "7d" | "30d" | "all"

  try {
    const data = await getAdminAIMetricsBundle(
      {
        dateFrom,
        dateTo,
        sport: sport === "all" ? null : sport,
        leagueType: leagueType === "all" ? null : leagueType,
        feature,
        userSegment,
      },
      timeRange,
    )
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load AI metrics" },
      { status: 500 },
    )
  }
}
