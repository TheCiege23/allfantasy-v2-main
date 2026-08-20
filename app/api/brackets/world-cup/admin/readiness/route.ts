import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getWorldCupOperationsReadiness } from "@/lib/world-cup"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { getWorldCupAdminState, requireWorldCupApiUser } from "../../_utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const querySchema = z.object({
  challengeId: z.string().min(1).optional(),
  seasonYear: z.coerce.number().int().min(2022).max(2030).optional(),
})

export async function GET(request: NextRequest) {
  const cronAuthorized = requireCronAuth(request, "WORLD_CUP_CRON_SECRET")
  if (!cronAuthorized) {
    const auth = await requireWorldCupApiUser(request)
    if (!auth.ok) return auth.response
    const isAdmin = await getWorldCupAdminState(request, auth.user)
    if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 })
  }

  const readiness = await getWorldCupOperationsReadiness(parsed.data)
  return NextResponse.json({
    ok: true,
    readiness,
    checkedAt: new Date().toISOString(),
  })
}
