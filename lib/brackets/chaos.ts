import { prisma } from "@/lib/prisma"

type ChaosMetrics = {
  tournamentId: string
  totalGamesFinal: number
  upsetCount: number
  avgSeedGapUpsets: number
  topSeedEliminations: number
  avgBracketAccuracy: number
  chaosScore: number
  label: "predictable" | "moderate" | "high" | "madness"
}

export async function computeTournamentChaos(tournamentId: string): Promise<ChaosMetrics> {
  const nodes = await prisma.bracketNode.findMany({
    where: { tournamentId },
    select: {
      id: true,
      round: true,
      seedHome: true,
      seedAway: true,
      homeTeamName: true,
      awayTeamName: true,
      sportsGameId: true,
    },
  })

  if (!nodes.length) {
    return {
      tournamentId,
      totalGamesFinal: 0,
      upsetCount: 0,
      avgSeedGapUpsets: 0,
      topSeedEliminations: 0,
      avgBracketAccuracy: 0,
      chaosScore: 0,
      label: "predictable",
    }
  }

  const gameIds = nodes.map((n) => n.sportsGameId).filter((id): id is string => !!id)
  const games = gameIds.length
    ? await prisma.sportsGame.findMany({
        where: { id: { in: gameIds } },
        select: { id: true, homeScore: true, awayScore: true, status: true },
      })
    : []
  const gameMap = new Map(games.map((g) => [g.id, g]))

  let upsetCount = 0
  let seedGapSum = 0
  let topSeedElims = 0
  let finalGames = 0

  for (const n of nodes) {
    if (!n.sportsGameId) continue
    const g = gameMap.get(n.sportsGameId)
    if (!g || g.homeScore == null || g.awayScore == null) continue
    const s = String(g.status || "").toLowerCase()
    const isFinal =
      s.includes("final") || s.includes("completed") || s.includes("closed") || s.includes("finished")
    if (!isFinal || g.homeScore === g.awayScore) continue

    finalGames++
    if (n.seedHome == null || n.seedAway == null) continue

    const favoriteSeed = Math.min(n.seedHome, n.seedAway)
    const underdogSeed = Math.max(n.seedHome, n.seedAway)
    const isHomeFav = n.seedHome === favoriteSeed
    const winnerIsHome = g.homeScore > g.awayScore
    const winnerIsFavorite = winnerIsHome ? isHomeFav : !isHomeFav

    if (!winnerIsFavorite) {
      upsetCount++
      const gap = underdogSeed - favoriteSeed
      seedGapSum += gap
      if (favoriteSeed <= 4) {
        topSeedElims++
      }
    }
  }

  const avgSeedGapUpsets = upsetCount > 0 ? seedGapSum / upsetCount : 0

  // Approximate average bracket accuracy using decided picks
  const decidedPicks = await prisma.bracketPick.findMany({
    where: {
      node: { tournamentId },
      isCorrect: { not: null },
    },
    select: { isCorrect: true },
  })
  const totalDecided = decidedPicks.length
  const correct = decidedPicks.filter((p) => p.isCorrect === true).length
  const avgBracketAccuracy = totalDecided > 0 ? correct / totalDecided : 0.5

  // Chaos score components
  const maxGames = nodes.length || 1
  const upsetFreq = finalGames > 0 ? upsetCount / finalGames : 0
  const gapFactor = Math.min(1, avgSeedGapUpsets / 8) // big seed gaps increase chaos
  const topSeedFactor = Math.min(1, topSeedElims / 8)
  const accuracyFactor = 1 - avgBracketAccuracy // lower accuracy -> more chaos

  let chaos = 0.35 * upsetFreq + 0.25 * gapFactor + 0.2 * topSeedFactor + 0.2 * accuracyFactor
  chaos = Math.max(0, Math.min(1, chaos))

  const chaosScore = Math.round(chaos * 100)
  let label: ChaosMetrics["label"]
  if (chaosScore < 20) label = "predictable"
  else if (chaosScore < 50) label = "moderate"
  else if (chaosScore < 80) label = "high"
  else label = "madness"

  return {
    tournamentId,
    totalGamesFinal: finalGames,
    upsetCount,
    avgSeedGapUpsets,
    topSeedEliminations: topSeedElims,
    avgBracketAccuracy,
    chaosScore,
    label,
  }
}

