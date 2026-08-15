import { NextResponse } from "next/server"
import { queryHallOfFameMoments } from "@/lib/hall-of-fame-engine/HallOfFameQueryService"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response
    const url = new URL(req.url)
    const sport = url.searchParams?.get("sport")
    const season = url.searchParams?.get("season")
    const limit = url.searchParams?.get("limit")
    const offset = url.searchParams?.get("offset")

    if (!leagueId) return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })

    const { moments, total } = await queryHallOfFameMoments({
      leagueId,
      sport: sport ?? null,
      season: season ?? null,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    })

    return NextResponse.json({ leagueId, moments, total })
  } catch (e) {
    console.error("[HallOfFame moments GET]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Unable to load Hall of Fame moments." },
      { status: 500 }
    )
  }
}
