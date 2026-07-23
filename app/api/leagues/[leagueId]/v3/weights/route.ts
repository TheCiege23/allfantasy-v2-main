import { NextResponse } from "next/server"
import { defaultWeights, saveWeightsSnapshot, listWeightsSnapshots } from "@/lib/rankings-engine/v3-weights"
import { withApiUsage } from "@/lib/telemetry/usage"
import { requireAdmin } from "@/lib/adminAuth"

export const GET = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/v3/weights",
  tool: "V3Weights"
})(async (req: Request, ctx: { params: { leagueId: string } }) => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const { leagueId } = ctx.params
  const url = new URL(req.url)
  const season = url.searchParams?.get("season") ?? undefined

  const rows = await listWeightsSnapshots({ leagueId, season, limit: 25 })
  return NextResponse.json({ leagueId, rows, default: defaultWeights() })
})

export const POST = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/v3/weights",
  tool: "V3Weights"
})(async (req: Request, ctx: { params: { leagueId: string } }) => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const { leagueId } = ctx.params
  const body = await req.json().catch(() => ({}))

  const season = String(body.season ?? "")
  const week = Number(body.week ?? 0)
  const weights = body.weights

  if (!leagueId || !season || !week || !weights) {
    return NextResponse.json({ error: "Missing leagueId/season/week/weights" }, { status: 400 })
  }

  const row = await saveWeightsSnapshot({
    leagueId,
    season,
    week,
    weights,
    metrics: body.metrics ?? null,
    reason: body.reason ?? "manual snapshot"
  })

  return NextResponse.json({ ok: true, row })
})
