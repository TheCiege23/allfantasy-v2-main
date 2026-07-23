import { NextResponse } from "next/server"
import { getDriftSeries, recordDriftMetrics } from "@/lib/rankings-engine/drift-metrics"
import { withApiUsage } from "@/lib/telemetry/usage"
import { requireAdmin } from "@/lib/adminAuth"

export const GET = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/v3/drift",
  tool: "DriftMetrics"
})(async (req: Request, ctx: { params: { leagueId: string } }) => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const { leagueId } = ctx.params
  const url = new URL(req.url)
  const days = Number(url.searchParams?.get("days") ?? 60)

  const rows = await getDriftSeries({ leagueId, days })
  return NextResponse.json({ leagueId, rows })
})

export const POST = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/v3/drift",
  tool: "DriftMetrics"
})(async (req: Request, ctx: { params: { leagueId: string } }) => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res

  const { leagueId } = ctx.params
  const body = await req.json().catch(() => ({}))

  const day = body.day ? new Date(body.day) : new Date()
  const row = await recordDriftMetrics({
    leagueId,
    day,
    mode: body.mode ?? "INSTANT",
    segmentKey: body.segmentKey ?? "global",
    nOffers: body.nOffers ?? 0,
    nLabeled: body.nLabeled ?? 0,
    nAccepted: body.nAccepted ?? 0,
    meanPred: body.meanPred ?? 0,
    meanObs: body.meanObs ?? 0,
    ece: body.ece ?? null,
    brier: body.brier ?? null,
    auc: body.auc ?? null,
    psiJson: body.psiJson ?? null,
    narrativeFailRate: body.narrativeFailRate ?? null
  })

  return NextResponse.json({ ok: true, row })
})
