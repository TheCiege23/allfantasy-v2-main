import { NextResponse } from "next/server"
import { getRankHistory } from "@/lib/rankings-engine/snapshots"
import { withApiUsage } from "@/lib/telemetry/usage"
import { buildBaselineMeta, ensureArray } from "@/lib/engine/response-guard"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const GET = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/rank-history",
  tool: "RankHistory"
})(async (req: Request, ctx: { params: { leagueId: string } }) => {
  const { leagueId } = ctx.params
  // Membership gate. Reachable both directly and via the [section]
  // dispatcher, and was open to anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response
  const url = new URL(req.url)
  const rosterId = String(url.searchParams?.get("rosterId") ?? "")
  const limit = Number(url.searchParams?.get("limit") ?? 12)

  if (!leagueId || !rosterId) {
    return NextResponse.json({ error: "Missing leagueId or rosterId" }, { status: 400 })
  }

  try {
    const rows = await getRankHistory({ leagueId, rosterId, limit })

    if (!rows || rows.length === 0) {
      return NextResponse.json({
        leagueId,
        rosterId,
        rows: [],
        meta: buildBaselineMeta(
          "no_snapshot_history",
          "Rank history will begin tracking once weekly snapshots are stored."
        ),
      })
    }

    return NextResponse.json({ leagueId, rosterId, rows: ensureArray(rows) })
  } catch (err: any) {
    console.error("[Rank History API]", err?.message)
    return NextResponse.json({
      leagueId,
      rosterId,
      rows: [],
      meta: buildBaselineMeta("error", "Unable to load rank history at this time."),
    })
  }
})
