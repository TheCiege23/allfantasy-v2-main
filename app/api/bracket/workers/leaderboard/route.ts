import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import { rebuildLeaderboardForScope } from "@/lib/brackets/leaderboard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  // Worker endpoint: it writes tournaments, nodes, picks or feed events, so it
  // takes the same cron/admin secret as sync-playoff. It was reachable anonymously.
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await req.json().catch(() => ({} as any))
    const tournamentId =
      typeof body.tournamentId === "string" && body.tournamentId.trim()
        ? body.tournamentId.trim()
        : null
    const leagueId =
      typeof body.leagueId === "string" && body.leagueId.trim()
        ? body.leagueId.trim()
        : null

    if (!tournamentId) {
      return NextResponse.json({ error: "tournamentId is required" }, { status: 400 })
    }

    const tournament = await prisma.bracketTournament.findUnique({
      where: { id: tournamentId },
      select: { id: true },
    })
    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 })
    }

    const result = await rebuildLeaderboardForScope({ tournamentId, leagueId })

    return NextResponse.json({
      ok: true,
      tournamentId,
      leagueId,
      entriesUpdated: result.updated,
    })
  } catch (err: any) {
    console.error("[workers/leaderboard] Error:", err)
    return NextResponse.json(
      { error: err?.message || "Leaderboard worker failed" },
      { status: 500 },
    )
  }
}

