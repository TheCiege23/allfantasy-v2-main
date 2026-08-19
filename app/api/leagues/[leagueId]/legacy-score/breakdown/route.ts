import { NextResponse } from "next/server"
import { getLegacyScoreByEntity } from "@/lib/legacy-score-engine/LegacyRankingService"
import { buildLegacyExplanationContext } from "@/lib/legacy-score-engine/AILegacyExplanationService"
import { DEFAULT_SPORT, normalizeToSupportedSport } from "@/lib/sport-scope"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = "force-dynamic"

/**
 * GET /api/leagues/[leagueId]/legacy-score/breakdown
 * Query: entityType, entityId, sport.
 * Returns full score breakdown for drill-down view.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const url = new URL(req.url)
    const entityType = url.searchParams?.get("entityType")
    const entityId = url.searchParams?.get("entityId")
    const sport = normalizeToSupportedSport(url.searchParams?.get("sport") ?? DEFAULT_SPORT)

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: "entityType and entityId are required" },
        { status: 400 }
      )
    }

    const record = await getLegacyScoreByEntity(
      entityType,
      entityId,
      sport,
      leagueId
    )
    if (!record) {
      return NextResponse.json(
        { error: "No legacy score record found. Run the legacy score engine for this league." },
        { status: 404 }
      )
    }

    const context = buildLegacyExplanationContext(record)
    return NextResponse.json({
      leagueId,
      record: {
        id: record.id,
        entityType: record.entityType,
        entityId: record.entityId,
        sport: record.sport,
        leagueId: record.leagueId,
        overallLegacyScore: record.overallLegacyScore,
        championshipScore: record.championshipScore,
        playoffScore: record.playoffScore,
        consistencyScore: record.consistencyScore,
        rivalryScore: record.rivalryScore,
        awardsScore: record.awardsScore,
        dynastyScore: record.dynastyScore,
        updatedAt: record.updatedAt.toISOString(),
      },
      breakdown: context.breakdown,
      explanationContext: context,
    })
  } catch (e) {
    console.error("[legacy-score/breakdown GET]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Failed to load score breakdown" },
      { status: 500 }
    )
  }
}
