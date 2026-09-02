import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { getApiHealthReport } from "@/lib/admin-dashboard/ApiHealthService"
import { getServedOrigin } from "@/lib/http/served-origin"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/api-health
 *
 * Admin-gated. Returns live health for core APIs/dependencies (DB ping, public
 * endpoint self-checks, env/provider/cron readiness) plus a ranked list of
 * potential errors. Never exposes secrets or raw provider payloads.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  // The report self-checks public endpoints against this origin. Built from
  // request.url it was https://0.0.0.0:8080, so every self-check failed and the
  // dashboard reported the whole app down — a health check that measured itself.
  const origin = getServedOrigin(request)
  try {
    const report = await getApiHealthReport(origin)
    return NextResponse.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : "API health check failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
