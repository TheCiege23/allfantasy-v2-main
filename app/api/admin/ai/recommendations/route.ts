/**
 * Admin — AI Recommendation Log
 * GET /api/admin/ai/recommendations
 *
 * Backs AIRecommendationTable.tsx (paginated recommendation log with search).
 * Admin-only endpoint.
 *
 * Query params:
 *   dateFrom, dateTo — YYYY-MM-DD (default: last 30 days)
 *   sport            — sport key or "all" (accepted, not currently filtered by the log query)
 *   feature          — AIFeatureCategory or "all"
 *   userSegment      — accepted for filter-state symmetry, not used by the log query
 *   search           — free-text match against summary/feature/user email/league name
 *   take             — page size (default 25, max 100)
 *   cursor           — opaque row id to page from
 */
import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { getRecommendationLogs } from "@/lib/ai/admin/getAIMetrics"

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
  const search = url.searchParams.get("search")
  const cursor = url.searchParams.get("cursor")
  const take = Math.min(100, Math.max(1, parseInt(url.searchParams.get("take") ?? "25", 10) || 25))

  try {
    const { rows, nextCursor } = await getRecommendationLogs(
      {
        dateFrom,
        dateTo,
        sport: sport === "all" ? null : sport,
        feature,
        userSegment,
      },
      { take, cursor, search },
    )
    return NextResponse.json({ ok: true, rows, nextCursor })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to load recommendation log" },
      { status: 500 },
    )
  }
}
