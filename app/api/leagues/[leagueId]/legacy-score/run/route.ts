import { NextResponse } from "next/server"
import { runLegacyScoreEngineForLeague } from "@/lib/legacy-score-engine/LegacyScoreEngine"
import type { LegacyEntityType } from "@/lib/legacy-score-engine/types"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = "force-dynamic"

/**
 * POST /api/leagues/[leagueId]/legacy-score/run
 * Run legacy score engine for all managers in the league.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const body = (await req.json().catch(() => ({}))) as Partial<{
      sport: string
      replace: boolean
      entityTypes: string[]
    }>
    const requestedEntityTypes = Array.isArray(body.entityTypes)
      ? body.entityTypes
          .map((row) => String(row ?? "").trim().toUpperCase())
          .filter((row): row is LegacyEntityType =>
            row === "MANAGER" || row === "TEAM" || row === "FRANCHISE"
          )
      : []

    const { processed, managerProcessed, teamProcessed, franchiseProcessed, results } =
      await runLegacyScoreEngineForLeague(leagueId, {
        sport: body.sport,
        replace: body.replace !== false,
        ...(requestedEntityTypes.length > 0 ? { entityTypes: requestedEntityTypes } : {}),
      })
    return NextResponse.json({
      ok: true,
      leagueId,
      processed,
      managerProcessed,
      teamProcessed,
      franchiseProcessed,
      results: results.slice(0, 80),
    })
  } catch (e) {
    console.error("[legacy-score/run POST]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Failed to run legacy score engine" },
      { status: 500 }
    )
  }
}
