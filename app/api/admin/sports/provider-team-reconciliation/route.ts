import { NextRequest, NextResponse } from "next/server"
import { requireAdminOrBearer } from "@/lib/adminAuth"
import { getProviderTeamReconciliationReport } from "@/lib/sports-reporting/ProviderTeamReconciliationService"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/sports/provider-team-reconciliation
 *
 * Returns provider team reconciliation drilldown data for the admin panel.
 * Includes summaries, topUnmapped (≤50), and topAmbiguous (≤20).
 *
 * Optional query params:
 *   - sports: comma-separated sport codes to limit scope (e.g. "NFL,WC_SOCCER")
 *   - include: "all" to include the full allResults set (may be large)
 */
export async function GET(request: NextRequest) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  const { searchParams } = new URL(request.url)
  const sportsParam = searchParams.get("sports")
  const sports = sportsParam
    ? sportsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : undefined
  const includeAll = searchParams.get("include") === "all"

  try {
    const report = await getProviderTeamReconciliationReport(sports)
    const response = {
      ok: true,
      generatedAt: report.generatedAt,
      summaries: report.summaries,
      totalProblems: report.totalProblems,
      topUnmapped: report.topUnmapped,
      topAmbiguous: report.topAmbiguous,
      ...(includeAll ? { allResults: report.allResults } : {}),
    }
    return NextResponse.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[admin/sports/provider-team-reconciliation] failed:", message)
    return NextResponse.json(
      { ok: false, error: "Provider team reconciliation failed", detail: message.slice(0, 240) },
      { status: 500 }
    )
  }
}
