import { prisma } from "@/lib/prisma"

type WinProbability = {
  teamA: number
  teamB: number
}

export type PickDistribution = {
  nodeId: string
  picks: Record<string, number>
  total: number
  publicPctA: number
  publicPctB: number
}

type SleeperScore = {
  team: string
  score: number
  label: "high_upset" | "moderate_upset" | "slight_edge" | "none"
  factors: {
    underdogBoost: number
    lowPublicPick: number
    seedGapAdvantage: number
  }
}

type LeverageScore = {
  nodeId: string
  score: number
  teamA: { name: string; leverage: number }
  teamB: { name: string; leverage: number }
}

type UniquenessScore = {
  score: number
  percentile: number
  pickContributions: Array<{
    nodeId: string
    team: string
    publicPct: number
    contribution: number
  }>
}

export type HealthMetrics = {
  alivePct: number
  teamsAlive: number
  teamsTotal: number
  maxPossiblePoints: number
  currentPoints: number
  currentRank: number
  totalEntries: number
  upside: number
  riskExposure: number
  championAlive: boolean
  finalFourAlive: number
  finalFourTotal: number
}

export function computeWinProbability(seedA: number | null, seedB: number | null): WinProbability {
  if (seedA == null || seedB == null) return { teamA: 0.5, teamB: 0.5 }
  const diff = seedB - seedA
  const sigmoid = 1 / (1 + Math.exp(-0.15 * diff * 4.5))
  const probA = Math.max(0.05, Math.min(0.95, sigmoid))
  return { teamA: Math.round(probA * 100) / 100, teamB: Math.round((1 - probA) * 100) / 100 }
}

export function computeSleeperScore(
  team: string,
  teamSeed: number | null,
  opponentSeed: number | null,
  publicPickPct: number
): SleeperScore {
  if (teamSeed == null || opponentSeed == null) {
    return { team, score: 0, label: "none", factors: { underdogBoost: 0, lowPublicPick: 0, seedGapAdvantage: 0 } }
  }

  const isUnderdog = teamSeed > opponentSeed

  if (!isUnderdog) {
    return { team, score: 0, label: "none", factors: { underdogBoost: 0, lowPublicPick: 0, seedGapAdvantage: 0 } }
  }

  const seedGap = teamSeed - opponentSeed
  const underdogBoost = Math.min(0.4, seedGap * 0.04)
  const lowPublicPick = Math.min(0.35, (1 - publicPickPct) * 0.4)
  const seedGapAdvantage = seedGap >= 4 && seedGap <= 8 ? 0.2 : seedGap > 8 ? 0.1 : 0.15

  const score = Math.min(1, underdogBoost + lowPublicPick + seedGapAdvantage)

  let label: SleeperScore["label"] = "none"
  if (score >= 0.75) label = "high_upset"
  else if (score >= 0.5) label = "moderate_upset"
  else if (score >= 0.3) label = "slight_edge"

  return {
    team,
    score: Math.round(score * 100) / 100,
    label,
    factors: {
      underdogBoost: Math.round(underdogBoost * 100) / 100,
      lowPublicPick: Math.round(lowPublicPick * 100) / 100,
      seedGapAdvantage: Math.round(seedGapAdvantage * 100) / 100,
    },
  }
}

export function computeLeverage(
  nodeId: string,
  teamA: string,
  teamB: string,
  pickDist: PickDistribution,
  round: number
): LeverageScore {
  const roundMultiplier = 1 + (round - 1) * 0.15
  const pickA = pickDist.publicPctA
  const pickB = pickDist.publicPctB

  const leverageA = Math.round(Math.min(1, (1 - pickA) * roundMultiplier) * 100) / 100
  const leverageB = Math.round(Math.min(1, (1 - pickB) * roundMultiplier) * 100) / 100

  const score = Math.round(Math.max(leverageA, leverageB) * 100) / 100

  return {
    nodeId,
    score,
    teamA: { name: teamA, leverage: leverageA },
    teamB: { name: teamB, leverage: leverageB },
  }
}

export function computeBracketUniqueness(
  picks: Array<{ nodeId: string; pickedTeamName: string }>,
  distributions: Map<string, PickDistribution>
): UniquenessScore {
  if (picks.length === 0) {
    return { score: 0, percentile: 50, pickContributions: [] }
  }

  const contributions: UniquenessScore["pickContributions"] = []
  let logSum = 0
  let count = 0

  for (const pick of picks) {
    const dist = distributions.get(pick.nodeId)
    if (!dist || dist.total === 0) continue

    const teamPicks = dist.picks[pick.pickedTeamName] ?? 0
    const publicPct = teamPicks / dist.total
    const contribution = Math.max(0.01, 1 - publicPct)

    logSum += Math.log(contribution)
    count++

    contributions.push({
      nodeId: pick.nodeId,
      team: pick.pickedTeamName,
      publicPct: Math.round(publicPct * 100) / 100,
      contribution: Math.round(contribution * 100) / 100,
    })
  }

  const rawScore = count > 0 ? Math.exp(logSum / count) : 0
  const score = Math.round(rawScore * 100)
  const percentile = Math.min(99, Math.max(1, Math.round(score * 1.2)))

  return { score, percentile, pickContributions: contributions }
}

export async function computePickDistribution(
  tournamentId: string,
  nodeIds?: string[]
): Promise<Map<string, PickDistribution>> {
  const where: any = { node: { tournamentId } }
  if (nodeIds?.length) where.nodeId = { in: nodeIds }

  const picks = await prisma.bracketPick.findMany({
    where,
    select: { nodeId: true, pickedTeamName: true },
  })

  const nodeMap = new Map<string, Record<string, number>>()

  for (const pick of picks) {
    if (!pick.pickedTeamName) continue
    const existing = nodeMap.get(pick.nodeId) ?? {}
    existing[pick.pickedTeamName] = (existing[pick.pickedTeamName] ?? 0) + 1
    nodeMap.set(pick.nodeId, existing)
  }

  const result = new Map<string, PickDistribution>()

  for (const [nodeId, pickCounts] of nodeMap) {
    const total = Object.values(pickCounts).reduce((a, b) => a + b, 0)
    const teams = Object.keys(pickCounts)
    const pctA = total > 0 ? (pickCounts[teams[0]] ?? 0) / total : 0.5
    const pctB = total > 0 ? (pickCounts[teams[1] ?? ""] ?? 0) / total : 0.5

    result.set(nodeId, {
      nodeId,
      picks: pickCounts,
      total,
      publicPctA: Math.round(pctA * 100) / 100,
      publicPctB: Math.round(pctB * 100) / 100,
    })
  }

  return result
}

export async function computeHealthScore(
  entryId: string,
  tournamentId: string
): Promise<HealthMetrics> {
  const [entry, allNodes, allEntries] = await Promise.all([
    prisma.bracketEntry.findUnique({
      where: { id: entryId },
      include: { picks: true },
    }),
    prisma.bracketNode.findMany({
      where: { tournamentId },
      include: {
        picks: { select: { points: true, isCorrect: true, entryId: true } },
      },
    }),
    prisma.bracketEntry.findMany({
      where: { league: { tournamentId } },
      include: { picks: { select: { points: true } } },
    }),
  ])

  if (!entry) {
    return {
      alivePct: 0,
      teamsAlive: 0,
      teamsTotal: 0,
      maxPossiblePoints: 0,
      currentPoints: 0,
      currentRank: 0,
      totalEntries: 0,
      upside: 0,
      riskExposure: 0,
      championAlive: false,
      finalFourAlive: 0,
      finalFourTotal: 0,
    }
  }

  const pickedTeams = new Set(entry.picks.map(p => p.pickedTeamName).filter(Boolean))
  const eliminatedTeams = new Set<string>()

  for (const node of allNodes) {
    const finalPicks = node.picks.filter(p => p.isCorrect === false)
    for (const fp of finalPicks) {
      const matchingPick = entry.picks.find(ep => ep.nodeId === node.id)
      if (matchingPick?.pickedTeamName) {
        eliminatedTeams.add(matchingPick.pickedTeamName)
      }
    }
  }

  const teamsTotal = pickedTeams.size
  const teamsAlive = teamsTotal - eliminatedTeams.size
  const alivePct = teamsTotal > 0 ? Math.round((teamsAlive / teamsTotal) * 100) / 100 : 0

  const currentPoints = entry.picks.reduce((s, p) => s + p.points, 0)

  const maxRound = Math.max(...allNodes.map(n => n.round))
  const roundPoints: Record<number, number> = { 1: 1, 2: 2, 3: 5, 4: 10, 5: 18, 6: 30 }
  let maxPossiblePoints = currentPoints
  for (const pick of entry.picks) {
    if (pick.isCorrect === null) {
      const node = allNodes.find(n => n.id === pick.nodeId)
      if (node) maxPossiblePoints += (roundPoints[node.round] ?? 0)
    }
  }

  const entryScores = allEntries
    .map(e => e.picks.reduce((s, p) => s + p.points, 0))
    .sort((a, b) => b - a)

  const currentRank = entryScores.filter(s => s > currentPoints).length + 1
  const totalEntries = allEntries.length

  const leaderScore = entryScores[0] ?? 0
  const upside = maxPossiblePoints - leaderScore

  const undecidedPicks = entry.picks.filter(p => p.isCorrect === null).length
  const totalPicks = entry.picks.length
  const riskExposure = totalPicks > 0 ? Math.round(((teamsTotal - teamsAlive) / Math.max(teamsTotal, 1)) * 100) / 100 : 0

  // Champion and Final Four survival
  const championshipNodes = allNodes.filter(n => n.round === 6)
  const championshipNodeIds = new Set(championshipNodes.map(n => n.id))
  const championPick = entry.picks.find(p => championshipNodeIds.has(p.nodeId) && p.pickedTeamName != null)
  const championAlive =
    championPick && championPick.pickedTeamName
      ? !eliminatedTeams.has(championPick.pickedTeamName)
      : true

  const finalFourNodes = allNodes.filter(n => n.round === 5)
  const finalFourNodeIds = new Set(finalFourNodes.map(n => n.id))
  const ffTeams = new Set<string>()
  for (const p of entry.picks) {
    if (finalFourNodeIds.has(p.nodeId) && p.pickedTeamName) {
      ffTeams.add(p.pickedTeamName)
    }
  }
  const finalFourTotal = ffTeams.size
  let finalFourAlive = 0
  for (const team of ffTeams) {
    if (!eliminatedTeams.has(team)) finalFourAlive++
  }

  return {
    alivePct,
    teamsAlive,
    teamsTotal,
    maxPossiblePoints,
    currentPoints,
    currentRank,
    totalEntries,
    upside,
    riskExposure,
    championAlive,
    finalFourAlive,
    finalFourTotal,
  }
}

type MonteCarloResult = {
  userId: string
  entryId: string
  winRate: number
  top3Rate: number
  expectedRank: number
  runs: number
}

export function runPoolSimulation(
  entries: Array<{
    entryId: string
    userId: string
    currentPoints: number
    remainingPicks: Array<{
      nodeId: string
      pickedTeamName: string
      round: number
      winProb: number
    }>
  }>,
  runs: number = 1000
): MonteCarloResult[] {
  const results = new Map<string, { wins: number; top3: number; rankSum: number }>()

  for (const entry of entries) {
    results.set(entry.entryId, { wins: 0, top3: 0, rankSum: 0 })
  }

  const roundPoints: Record<number, number> = { 1: 1, 2: 2, 3: 5, 4: 10, 5: 18, 6: 30 }

  for (let sim = 0; sim < runs; sim++) {
    const simScores: Array<{ entryId: string; userId: string; score: number }> = []

    for (const entry of entries) {
      let score = entry.currentPoints

      for (const pick of entry.remainingPicks) {
        if (Math.random() < pick.winProb) {
          score += roundPoints[pick.round] ?? 0
        }
      }

      simScores.push({ entryId: entry.entryId, userId: entry.userId, score })
    }

    simScores.sort((a, b) => b.score - a.score)

    for (let rank = 0; rank < simScores.length; rank++) {
      const r = results.get(simScores[rank].entryId)!
      if (rank === 0) r.wins++
      if (rank < 3) r.top3++
      r.rankSum += rank + 1
    }
  }

  return entries.map(entry => {
    const r = results.get(entry.entryId)!
    return {
      userId: entry.userId,
      entryId: entry.entryId,
      winRate: Math.round((r.wins / runs) * 10000) / 10000,
      top3Rate: Math.round((r.top3 / runs) * 10000) / 10000,
      expectedRank: Math.round((r.rankSum / runs) * 10) / 10,
      runs,
    }
  })
}

export function combineHealthComponents(args: {
  health: HealthMetrics
  remainingPoints: number
  championAlive: boolean
  finalFourAliveRatio: number
  uniquenessScore: number
  winLeagueProbability?: number | null
}): { score: number; statusLabel: string } {
  const { health, remainingPoints, championAlive, finalFourAliveRatio, uniquenessScore, winLeagueProbability } = args

  const rankFactor =
    health.totalEntries > 1
      ? 1 - (health.currentRank - 1) / Math.max(health.totalEntries - 1, 1)
      : 1
  const aliveFactor = health.alivePct
  const riskFactor = 1 - (health.riskExposure || 0)
  const upsideFactor =
    health.maxPossiblePoints > 0
      ? Math.max(0, Math.min(1, remainingPoints / Math.max(health.maxPossiblePoints, 1)))
      : 0
  const championFactor = championAlive ? 1 : 0
  const ffFactor = Math.max(0, Math.min(1, finalFourAliveRatio))
  const uniqFactor = Math.max(0, Math.min(1, uniquenessScore / 100))
  const winProbFactor =
    typeof winLeagueProbability === "number" && Number.isFinite(winLeagueProbability)
      ? Math.max(0, Math.min(1, winLeagueProbability))
      : 0

  let s =
    0.2 * aliveFactor +
    0.2 * rankFactor +
    0.15 * riskFactor +
    0.1 * upsideFactor +
    0.1 * championFactor +
    0.05 * ffFactor +
    0.1 * winProbFactor +
    0.1 * uniqFactor

  if (!championAlive) {
    s -= 0.05
  }

  s = Math.max(0, Math.min(1, s))

  const score = Math.round(s * 100)
  const statusLabel =
    s >= 0.75 ? "strong" : s >= 0.5 ? "stable" : s >= 0.25 ? "fragile" : "on_the_edge"

  return { score, statusLabel }
}

export function computePostTournamentInsights(
  picks: Array<{
    nodeId: string
    pickedTeamName: string | null
    isCorrect: boolean | null
    points: number
    round: number
    seedPicked: number | null
    seedActualWinner: number | null
  }>,
  distributions: Map<string, PickDistribution>
): {
  bestLeveragePick: { nodeId: string; team: string; leverageGained: number } | null
  worstEvMistake: { nodeId: string; team: string; publicPct: number } | null
  pointsLeftOnTable: number
  totalPoints: number
  correctPicks: number
  totalPicks: number
  accuracy: number
  upsetsCalled: number
  upsetsCorrect: number
} {
  let bestLeveragePick: { nodeId: string; team: string; leverageGained: number } | null = null
  let worstEvMistake: { nodeId: string; team: string; publicPct: number } | null = null
  let pointsLeftOnTable = 0
  let upsetsCalled = 0
  let upsetsCorrect = 0

  const roundPoints: Record<number, number> = { 1: 1, 2: 2, 3: 5, 4: 10, 5: 18, 6: 30 }

  for (const pick of picks) {
    if (!pick.pickedTeamName) continue

    const dist = distributions.get(pick.nodeId)
    const publicPct = dist && dist.total > 0
      ? (dist.picks[pick.pickedTeamName] ?? 0) / dist.total
      : 0.5

    const isUpset = pick.seedPicked != null && pick.seedActualWinner != null && pick.seedPicked > pick.seedActualWinner

    if (isUpset) upsetsCalled++

    if (pick.isCorrect === true) {
      if (isUpset) upsetsCorrect++

      const leverageGained = 1 - publicPct
      if (!bestLeveragePick || leverageGained > bestLeveragePick.leverageGained) {
        bestLeveragePick = { nodeId: pick.nodeId, team: pick.pickedTeamName, leverageGained: Math.round(leverageGained * 100) / 100 }
      }
    } else if (pick.isCorrect === false) {
      pointsLeftOnTable += roundPoints[pick.round] ?? 0

      if (publicPct > 0.6) {
        if (!worstEvMistake || publicPct > worstEvMistake.publicPct) {
          worstEvMistake = { nodeId: pick.nodeId, team: pick.pickedTeamName, publicPct: Math.round(publicPct * 100) / 100 }
        }
      }
    }
  }

  const correctPicks = picks.filter(p => p.isCorrect === true).length
  const decidedPicks = picks.filter(p => p.isCorrect !== null).length
  const totalPoints = picks.reduce((s, p) => s + p.points, 0)

  return {
    bestLeveragePick,
    worstEvMistake,
    pointsLeftOnTable,
    totalPoints,
    correctPicks,
    totalPicks: decidedPicks,
    accuracy: decidedPicks > 0 ? Math.round((correctPicks / decidedPicks) * 100) / 100 : 0,
    upsetsCalled,
    upsetsCorrect,
  }
}
