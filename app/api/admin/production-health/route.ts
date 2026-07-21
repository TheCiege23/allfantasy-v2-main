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

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/admin/production-health
 * Protected via `requireAdminOrBearer` (admin cookie, bearer token, or cron secret).
 *
 * Query params:
 *   ?view=system|crons|providers|cache|imports|warehouse  (default: system)
 *   ?sport=NFL                                   (returns a single sport's health)
 */
export async function GET(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  try {
    const url = new URL(request.url)
    const view = (url.searchParams.get("view") ?? "system").toLowerCase()
    const sport = url.searchParams.get("sport")

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
      case "system":
      default:
        return NextResponse.json(await getSystemHealth())
    }
  } catch (error) {
    console.error("[api/admin/production-health]", error)
    return NextResponse.json({ error: "Failed to load production health" }, { status: 500 })
  }
}
