import { NextResponse } from "next/server"
import { upsertSeasonResults } from "@/lib/rankings-engine/hall-of-fame"
import { withApiUsage } from "@/lib/telemetry/usage"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const POST = withApiUsage({
  endpoint: "/api/leagues/[leagueId]/season-results",
  tool: "SeasonResults"
})(async (req: Request, ctx: { params: { leagueId: string } }) => {
  const { leagueId } = ctx.params
  // Membership gate. Reachable both directly and via the [section]
  // dispatcher, and was open to anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response
  const body = await req.json().catch(() => ({}))
  const season = String(body.season ?? "")
  const rows = Array.isArray(body.rows) ? body.rows : []

  if (!leagueId || !season || !rows.length) {
    return NextResponse.json({ error: "Missing leagueId/season/rows" }, { status: 400 })
  }

  await upsertSeasonResults({
    leagueId,
    season,
    rows: rows.map((r: any) => ({
      rosterId: String(r.rosterId),
      wins: r.wins ?? null,
      losses: r.losses ?? null,
      pointsFor: r.pointsFor ?? null,
      pointsAgainst: r.pointsAgainst ?? null,
      champion: !!r.champion
    }))
  })

  return NextResponse.json({ ok: true, leagueId, season, count: rows.length })
})
