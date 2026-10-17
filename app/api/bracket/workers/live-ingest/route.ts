import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import { selectBestProvider } from "@/lib/brackets/providers"
import { checkUpsetImpact, checkChampEliminated, checkPerfectBrackets } from "@/lib/brackets/feed-engine"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  // Worker endpoint: it writes tournaments, nodes, picks or feed events, so it
  // takes the same cron/admin secret as sync-playoff. It was reachable anonymously.
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await req.json().catch(() => ({} as any))
    const tournamentId = body?.tournamentId

    if (!tournamentId) {
      return NextResponse.json({ error: "Missing tournamentId" }, { status: 400 })
    }

    const tournament = await prisma.bracketTournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, season: true, sport: true },
    })

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 })
    }

    const provider = await selectBestProvider()
    const caps = await provider.capabilities()

    console.log(`[LiveIngest] Provider: ${provider.name}, tournament: ${tournamentId}`)

    const nodes = await prisma.bracketNode.findMany({
      where: { tournamentId, sportsGameId: { not: null } },
      select: {
        id: true,
        sportsGameId: true,
        round: true,
        homeTeamName: true,
        awayTeamName: true,
        seedHome: true,
        seedAway: true,
        nextNodeId: true,
        nextNodeSide: true,
      },
    })

    const gameIds = nodes.map((n) => n.sportsGameId!).filter(Boolean)
    let updatedGames = 0
    let finalized = 0
    let advanced = 0

    if (caps.live_scores && gameIds.length > 0) {
      const liveData = await provider.getLiveScores(gameIds)
      const liveByTeamPair = new Map<string, typeof liveData[0]>()
      for (const g of liveData) {
        const key1 = `${g.homeTeam.toLowerCase()}|${g.awayTeam.toLowerCase()}`
        const key2 = `${g.awayTeam.toLowerCase()}|${g.homeTeam.toLowerCase()}`
        liveByTeamPair.set(key1, g)
        liveByTeamPair.set(key2, g)
      }

      const existingGames = await prisma.sportsGame.findMany({
        where: { id: { in: gameIds } },
        select: { id: true, homeTeam: true, awayTeam: true, status: true },
      })

      for (const eg of existingGames) {
        const key = `${eg.homeTeam.toLowerCase()}|${eg.awayTeam.toLowerCase()}`
        const live = liveByTeamPair.get(key)
        if (!live) continue

        if (live.status !== "unknown") {
          await prisma.sportsGame.update({
            where: { id: eg.id },
            data: {
              homeScore: live.homeScore,
              awayScore: live.awayScore,
              status: live.status,
              fetchedAt: new Date(),
            },
          })
          updatedGames++

          if (live.status === "final" && eg.status !== "final") {
            const winner =
              live.homeScore != null && live.awayScore != null && live.homeScore !== live.awayScore
                ? live.homeScore > live.awayScore
                  ? live.homeTeam
                  : live.awayTeam
                : null

            if (winner) {
              const matchingNodes = nodes.filter((n) => n.sportsGameId === eg.id)

              for (const node of matchingNodes) {
                const nodeWinner =
                  node.homeTeamName?.toLowerCase() === winner.toLowerCase()
                    ? node.homeTeamName
                    : node.awayTeamName?.toLowerCase() === winner.toLowerCase()
                    ? node.awayTeamName
                    : null

                if (!nodeWinner) continue

                const ROUND_PTS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32 }
                const pts = ROUND_PTS[node.round] ?? 0

                await prisma.bracketPick.updateMany({
                  where: { nodeId: node.id, pickedTeamName: nodeWinner },
                  data: { isCorrect: true, points: pts },
                })

                await prisma.bracketPick.updateMany({
                  where: {
                    nodeId: node.id,
                    pickedTeamName: { not: null },
                    NOT: { pickedTeamName: nodeWinner },
                  },
                  data: { isCorrect: false, points: 0 },
                })

                finalized++

                if (node.nextNodeId && node.nextNodeSide) {
                  await prisma.bracketNode.update({
                    where: { id: node.nextNodeId },
                    data:
                      node.nextNodeSide === "home"
                        ? { homeTeamName: nodeWinner }
                        : { awayTeamName: nodeWinner },
                  })
                  advanced++
                }

                const loser = nodeWinner === node.homeTeamName ? node.awayTeamName : node.homeTeamName
                const winnerSeed = nodeWinner === node.homeTeamName ? node.seedHome : node.seedAway
                const loserSeed = nodeWinner === node.homeTeamName ? node.seedAway : node.seedHome

                try {
                  if (loser && winnerSeed != null && loserSeed != null) {
                    await checkUpsetImpact(tournamentId, nodeWinner, loser, winnerSeed, loserSeed, node.id)
                    await checkChampEliminated(tournamentId, loser, loserSeed)
                  }
                } catch (feedErr) {
                  console.error("[LiveIngest] Feed event error:", feedErr)
                }
              }
            }
          }
        }
      }
    }

    try {
      await checkPerfectBrackets(tournamentId)
    } catch (feedErr) {
      console.error("[LiveIngest] Perfect bracket check error:", feedErr)
    }

    const supportsPlayByPlay = caps.play_by_play && typeof provider.getPlayByPlay === "function"

    return NextResponse.json({
      ok: true,
      provider: provider.name,
      tournamentId,
      updatedGames,
      finalized,
      advanced,
      playByPlaySupported: supportsPlayByPlay,
      playByPlayNote: !supportsPlayByPlay
        ? "Play-by-play not supported by current data provider. Showing score-only updates."
        : undefined,
    })
  } catch (err: any) {
    console.error("[LiveIngest] Error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
