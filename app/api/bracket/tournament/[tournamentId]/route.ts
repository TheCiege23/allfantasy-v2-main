import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_req: Request, props: { params: Promise<{ tournamentId: string }> }) {
  const params = await props.params
  try {
    const { tournamentId } = params

    const nodes = await prisma.bracketNode.findMany({
      where: { tournamentId },
      orderBy: [{ round: "asc" }, { region: "asc" }, { slot: "asc" }],
    })

    const gameIds = nodes
      .map((n) => n.sportsGameId)
      .filter(Boolean) as string[]

    const games =
      gameIds.length > 0
        ? await prisma.sportsGame.findMany({
            where: { id: { in: gameIds } },
            select: {
              id: true,
              homeTeam: true,
              awayTeam: true,
              homeScore: true,
              awayScore: true,
              status: true,
              startTime: true,
            },
          })
        : []

    const gameById = Object.fromEntries(games.map((g) => [g.id, g]))

    return NextResponse.json({
      nodes: nodes.map((n) => ({
        ...n,
        game: n.sportsGameId ? gameById[n.sportsGameId] ?? null : null,
      })),
    })
  } catch (err) {
    console.error("[bracket/tournament] Error:", err)
    return NextResponse.json(
      { error: "Failed to fetch bracket" },
      { status: 500 }
    )
  }
}
