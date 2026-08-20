import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runHallOfFameEngineForLeague } from "@/lib/hall-of-fame-engine/HallOfFameService"
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = "force-dynamic"

/**
 * POST /api/leagues/[leagueId]/hall-of-fame/run
 * Body: { sport?: string, maxSeasons?: number }
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

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, sport: true },
    })
    if (!league) return NextResponse.json({ error: "League not found" }, { status: 404 })

    const body = (await req.json().catch(() => ({}))) as Partial<{
      sport: string
      maxSeasons: number | string
    }>
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

    const result = await runHallOfFameEngineForLeague({
      leagueId,
      sport: body.sport ?? league.sport,
      maxSeasons,
    })
    return NextResponse.json({ leagueId, ...result })
  } catch (e) {
    console.error("[HallOfFame run POST]", e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: "Unable to run Hall of Fame engine." },
      { status: 500 }
    )
  }
}
