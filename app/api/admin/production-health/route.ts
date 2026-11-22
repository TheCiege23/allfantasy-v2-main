import { NextResponse } from "next/server"

import { requireAdminOrBearer } from "@/lib/adminAuth"
import {
  getCacheHealth,
  getCronStatus,
  getImportStatus,
  getProviderHealth,
  getSportHealth,
  getSystemHealth,
} from "@/lib/production-health/ProductionHealthService"
import { getSportsWarehouseHealth } from "@/lib/data-warehouse/warehouseDataState"
import { getTradeOsHealth } from '@/lib/trade-monitoring/tradeOsHealth'
import { isSupportedSport } from '@/lib/sport-scope'

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 180

/**
 * GET /api/admin/production-health
 * Protected via `requireAdminOrBearer` (admin cookie, bearer token, or cron secret).
 *
 * Query params:
 *   ?view=system|crons|providers|cache|imports|warehouse|trades|projection-coverage  (default: system)
 *   ?sport=NFL                                   (returns a single sport's health)
 */
export async function GET(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  try {
    const url = new URL(request.url)
    const view = (url.searchParams.get("view") ?? "system").toLowerCase()
    const sport = url.searchParams.get("sport")

    if (view === "projection-coverage") {
      const leagueId = url.searchParams.get("leagueId")?.trim() || undefined
      const selectedSport = sport?.toUpperCase()
      if ((selectedSport != null && !isSupportedSport(selectedSport)) || (leagueId && !selectedSport)) {
        return NextResponse.json({ error: "Provide a supported sport when selecting a league" }, { status: 400 })
      }
      const { buildProjectionCoverageReport } = await import("@/lib/production-health/projectionCoverageReport")
      const report = await buildProjectionCoverageReport({ sport: selectedSport, leagueId })
      const headers = { "Cache-Control": "private, no-store" }
      if (url.searchParams.get("format") === "text") {
        const { formatProjectionCoverage } = await import("@/lib/production-health/formatProjectionCoverage")
        return new Response(formatProjectionCoverage(report), { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } })
      }
      return NextResponse.json(report, { headers })
    }

    if (sport) {
      return NextResponse.json(await getSportHealth(sport))
    }

    switch (view) {
      case "crons":
        return NextResponse.json(await getCronStatus())
      case "providers":
        return NextResponse.json(await getProviderHealth())
      case "cache":
        return NextResponse.json(await getCacheHealth())
      case "imports":
        return NextResponse.json(await getImportStatus())
      // CRITICAL when PlayerGameStat/PlayerGameFact are empty — the silent state where
      // best-ball treated missing stats as real zeros and warehouse history rendered blank.
      case "warehouse":
        return NextResponse.json(await getSportsWarehouseHealth())
      case "trades":
        return NextResponse.json(await getTradeOsHealth())
      case "system":
      default:
        return NextResponse.json(await getSystemHealth())
    }
  } catch (error) {
    console.error("[api/admin/production-health]", error)
    return NextResponse.json({ error: "Failed to load production health" }, { status: 500 })
  }
}
