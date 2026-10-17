import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import { lockTournamentBrackets } from "@/lib/brackets/lock"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  // Worker endpoint: it writes tournaments, nodes, picks or feed events, so it
  // takes the same cron/admin secret as sync-playoff. It was reachable anonymously.
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await req.json().catch(() => ({} as any))
    const now = new Date()

    const tournamentId =
      typeof body?.tournamentId === "string" && body.tournamentId.trim()
        ? body.tournamentId.trim()
        : null

    let tournaments: { id: string; lockAt: Date | null }[]

    if (tournamentId) {
      const t = await prisma.bracketTournament.findUnique({
        where: { id: tournamentId },
        select: { id: true, lockAt: true },
      })
      tournaments = t ? [t] : []
    } else {
      tournaments = await prisma.bracketTournament.findMany({
        where: {
          lockAt: { not: null, lte: now },
        },
        select: { id: true, lockAt: true },
      })
    }

    if (!tournaments.length) {
      return NextResponse.json({
        ok: true,
        lockedEntries: 0,
        tournamentsProcessed: 0,
        message: "No tournaments eligible for locking",
      })
    }

    let totalLocked = 0
    for (const t of tournaments) {
      const { lockedEntries } = await lockTournamentBrackets(t.id, now)
      totalLocked += lockedEntries
    }

    return NextResponse.json({
      ok: true,
      tournamentsProcessed: tournaments.length,
      lockedEntries: totalLocked,
      runAt: now.toISOString(),
    })
  } catch (err: any) {
    console.error("[BracketLockWorker] Error:", err)
    return NextResponse.json({ error: err?.message || "Lock worker failed" }, { status: 500 })
  }
}

