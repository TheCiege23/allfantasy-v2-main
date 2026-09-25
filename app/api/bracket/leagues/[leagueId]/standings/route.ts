import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: { leagueId: string } }
) {
  try {
    const { leagueId } = params

    const league = await prisma.bracketLeague.findUnique({
      where: { id: leagueId },
      select: {
        scoringRules: true,
        tournamentId: true,
      },
    })

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 })
    }

    const entries = await prisma.bracketEntry.findMany({
      where: {
        leagueId,
        status: { notIn: ["DRAFT", "INVALIDATED"] },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        tiebreakerPoints: true,
        user: { select: { displayName: true, username: true } },
      },
    })

    const sums = await prisma.bracketPick.groupBy({
      by: ["entryId"],
      where: { entryId: { in: entries.map((e) => e.id) } },
      _sum: { points: true },
      _count: { _all: true },
    })

    const scoreByEntry = new Map(sums.map((s) => [s.entryId, s._sum.points ?? 0]))
    const pickCountByEntry = new Map(sums.map((s) => [s.entryId, s._count?._all ?? 0]))

    const championshipNode = await prisma.bracketNode.findFirst({
      where: { tournamentId: league.tournamentId, round: 6 },
      select: { sportsGameId: true },
    })
    const championshipGame = championshipNode?.sportsGameId
      ? await prisma.sportsGame.findUnique({
          where: { id: championshipNode.sportsGameId },
          select: { homeScore: true, awayScore: true },
        })
      : null

    const actualChampionshipTotalPoints =
      championshipGame?.homeScore != null && championshipGame?.awayScore != null
        ? championshipGame.homeScore + championshipGame.awayScore
        : null

    const tiebreakerEnabled = Boolean((league.scoringRules as any)?.tiebreakerEnabled)

    const rows = entries
      .map((e) => {
        const tiebreakerPoints = e.tiebreakerPoints ?? null
        const tiebreakerDelta =
          tiebreakerEnabled && actualChampionshipTotalPoints != null && tiebreakerPoints != null
            ? Math.abs(tiebreakerPoints - actualChampionshipTotalPoints)
            : null

        return {
          entryId: e.id,
          entryName: e.name,
          // Never the email: standings are shown to every member of the pool.
          ownerName: e.user?.displayName || e.user?.username || "Manager",
          points: scoreByEntry.get(e.id) ?? 0,
          picksCount: pickCountByEntry.get(e.id) ?? 0,
          createdAt: e.createdAt,
          tiebreakerPoints,
          tiebreakerDelta,
        }
      })
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points
        if (a.tiebreakerDelta != null && b.tiebreakerDelta != null) {
          if (a.tiebreakerDelta !== b.tiebreakerDelta) return a.tiebreakerDelta - b.tiebreakerDelta
        } else if (a.tiebreakerDelta != null) {
          return -1
        } else if (b.tiebreakerDelta != null) {
          return 1
        }
        if (b.picksCount !== a.picksCount) return b.picksCount - a.picksCount
        return a.createdAt.getTime() - b.createdAt.getTime()
      })

    let rankCursor = 1
    let previousKey: string | null = null
    const standings = rows.map((row, idx) => {
      const key = `${row.points}:${row.tiebreakerDelta ?? "na"}:${row.picksCount}`
      if (idx === 0) {
        rankCursor = 1
      } else if (key !== previousKey) {
        rankCursor = idx + 1
      }
      previousKey = key

      return {
        entryId: row.entryId,
        entryName: row.entryName,
        ownerName: row.ownerName,
        points: row.points,
        picksCount: row.picksCount,
        rank: rankCursor,
        tieKey: key,
        tiebreakerPoints: row.tiebreakerPoints,
        tiebreakerDelta: row.tiebreakerDelta,
      }
    })

    return NextResponse.json({
      leagueId,
      standings,
      tieBreakPolicy: "points_desc_then_tiebreaker_delta_asc_then_picks_desc_then_entry_created_asc",
      actualChampionshipTotalPoints,
    })
  } catch (err) {
    console.error("[bracket/standings] Error:", err)
    return NextResponse.json(
      { error: "Failed to fetch standings" },
      { status: 500 }
    )
  }
}
