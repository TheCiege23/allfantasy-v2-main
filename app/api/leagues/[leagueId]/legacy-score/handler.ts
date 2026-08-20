import { NextResponse } from "next/server"
import { queryLegacyLeaderboard, getLegacyScoreByEntity } from "@/lib/legacy-score-engine/LegacyRankingService"
import { DEFAULT_SPORT, normalizeToSupportedSport } from "@/lib/sport-scope"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = "force-dynamic"

/**
 * GET /api/leagues/[leagueId]/legacy-score
 * Query: entityType, entityId (single), sport, limit, offset.
 * If entityId (+ entityType): return single record. Else: leaderboard list.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    // Membership gate. Reachable both directly and via the [section]
    // dispatcher, and was open to anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const url = new URL(req.url)
    const entityType = url.searchParams?.get("entityType") ?? undefined
    const entityId = url.searchParams?.get("entityId") ?? undefined
    const sport = url.searchParams?.get("sport") ?? undefined
    const limit = url.searchParams?.get("limit")
    const offset = url.searchParams?.get("offset")

    if (entityId && entityType) {
      const sportResolved = sport ? normalizeToSupportedSport(sport) : DEFAULT_SPORT
      const record = await getLegacyScoreByEntity(
        entityType,
        entityId,
        sportResolved,
        leagueId
      )
      return NextResponse.json({ leagueId, record: record ?? null })
    }

    const { records, total } = await queryLegacyLeaderboard({
      leagueId,
      sport: sport ? normalizeToSupportedSport(sport) : null,
      entityType: entityType ?? null,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    })
    return NextResponse.json({ leagueId, records, total })
  } catch (e) {
    console.error("[legacy-score GET]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Failed to load legacy scores" },
      { status: 500 }
    )
  }
}
