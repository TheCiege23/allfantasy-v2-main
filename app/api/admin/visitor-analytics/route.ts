import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { getVisitorAnalytics } from "@/lib/admin-dashboard/VisitorAnalyticsService"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/visitor-analytics?window=6h|12h|24h|7d|1mo|6mo|12mo
 *
 * Admin-gated. Returns time-bucketed unique-vs-total visit counts for every
 * window (summary cards), a zero-filled series for the requested window (charts),
 * and geolocated points for the globe. Never returns raw IP addresses.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const url = new URL(request.url)
  const window = url.searchParams.get("window")

  try {
    const data = await getVisitorAnalytics(window)
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Visitor analytics failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
