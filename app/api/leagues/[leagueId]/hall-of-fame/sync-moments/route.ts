import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { syncHistoricMomentsForLeague } from "@/lib/hall-of-fame-engine/HallOfFameService"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

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
      maxSeasons: number | string
    }>
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true },
    })
    const sport = body.sport ?? league?.sport ?? "NFL"
    const sportStr = typeof sport === "string" ? sport : String(sport)
    const maxSeasonsCandidate =
      typeof body.maxSeasons === "number"
        ? body.maxSeasons
        : typeof body.maxSeasons === "string"
          ? parseInt(body.maxSeasons, 10)
          : NaN
    const maxSeasons =
      Number.isFinite(maxSeasonsCandidate) && !Number.isNaN(maxSeasonsCandidate)
        ? maxSeasonsCandidate
        : undefined

    const { created } = await syncHistoricMomentsForLeague(leagueId, sportStr, {
      maxSeasons,
    })
    return NextResponse.json({ ok: true, leagueId, created, sport: sportStr })
  } catch (e) {
    console.error("[HallOfFame sync-moments POST]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Unable to sync Hall of Fame moments." },
      { status: 500 }
    )
  }
}
