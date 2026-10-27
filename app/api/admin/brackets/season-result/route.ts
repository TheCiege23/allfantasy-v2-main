import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/adminAuth"
import { logAdminAudit, resolveAdminAuditActor } from "@/lib/admin-audit"
import { publishSeasonBracketFinal } from "@/lib/playoffs/publishSeasonBracketFinal"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.res
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const sport = body?.sport === "ncaaf" || body?.sport === "nba_cup" ? body.sport : null
  if (!sport) return NextResponse.json({ error: "Valid tournament is required." }, { status: 400 })
  const season = Number(body?.season)
  const seriesNumber = Number(body?.seriesNumber)
  const homeScore = body?.homeScore == null ? NaN : Number(body.homeScore)
  const awayScore = body?.awayScore == null ? NaN : Number(body.awayScore)
  const result = await publishSeasonBracketFinal({ sport, season, seriesNumber, homeScore, awayScore })
  if (!result.ok) {
    const status = result.error.startsWith("Valid") ? 400 : 409
    return NextResponse.json({ error: result.error }, { status })
  }
  await logAdminAudit({
    adminUserId: resolveAdminAuditActor(gate.user),
    action: "season_bracket_result.publish",
    targetType: "bracket_season_game", targetId: `${sport}:${season}:${seriesNumber}`,
    details: { sport, season, seriesNumber, homeScore, awayScore, updatedPools: result.updatedPools, totalPools: result.totalPools },
  })
  return NextResponse.json({ ok: true, ...result })
}
