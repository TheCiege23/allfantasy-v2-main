import { computeWinProbability } from "./intelligence/data-engine"

type NormalizedTeamAnalytics = {
  teamId: string
  tournamentId: string
  seasonYear: number
  teamName: string
  seed: number | null
  region: string | null
  record?: string | null
  ranking?: number | null
  offensiveRating?: number | null
  defensiveRating?: number | null
  netRating?: number | null
  strengthOfSchedule?: number | null
  recentForm?: number | null
  injuryFlags?: string[]
  sourceTimestamp: string
}

type MatchupAnalytics = {
  tournamentId: string
  gameId: string
  round: number
  team1: NormalizedTeamAnalytics
  team2: NormalizedTeamAnalytics
  probabilityTeam1: number
  probabilityTeam2: number
  upsetProbability: number
  favoriteTeamId: string | null
  confidenceLabel: "low" | "medium" | "high"
  keyFactors: string[]
  freshnessTimestamp: string
}

type SeedHistoryMetric = {
  sport: "ncaam"
  higherSeed: number
  lowerSeed: number
  round: number
  higherSeedWinRate: number
  lowerSeedWinRate: number
  upsetRate: number
  sampleSize: number
}

export type BracketNodeLite = {
  id: string
  round: number
  homeTeamName: string | null
  awayTeamName: string | null
  nextNodeId: string | null
  nextNodeSide: "home" | "away" | null
}

export type NodeProbabilityMap = Record<
  string,
  { pHome: number; pAway: number }
>

type BracketSimulationSummary = {
  tournamentId: string
  entryId: string
  simulations: number
  winLeagueProbability: number
  top5Probability: number
  expectedRank: number
  finalFourFrequency: Record<string, number>
  championshipFrequency: Record<string, number>
}

export function normalizeTeamAnalytics(args: {
  tournamentId: string
  seasonYear: number
  teamId: string
  teamName: string
  seed?: number | null
  region?: string | null
  record?: string | null
  ranking?: number | null
  offensiveRating?: number | null
  defensiveRating?: number | null
  strengthOfSchedule?: number | null
  recentForm?: number | null
  injuryFlags?: string[] | null
  sourceTimestamp?: string
}): NormalizedTeamAnalytics {
  const {
    tournamentId,
    seasonYear,
    teamId,
    teamName,
    seed = null,
    region = null,
    record = null,
    ranking = null,
    offensiveRating = null,
    defensiveRating = null,
    strengthOfSchedule = null,
    recentForm = null,
    injuryFlags = null,
    sourceTimestamp,
  } = args

  const ts = sourceTimestamp || new Date().toISOString()

  return {
    tournamentId,
    seasonYear,
    teamId,
    teamName,
    seed,
    region,
    record,
    ranking,
    offensiveRating,
    defensiveRating,
    netRating:
      offensiveRating != null && defensiveRating != null
        ? offensiveRating - defensiveRating
        : null,
    strengthOfSchedule,
    recentForm,
    injuryFlags: injuryFlags?.filter(Boolean) ?? [],
    sourceTimestamp: ts,
  }
}

const SEED_HISTORY: SeedHistoryMetric[] = [
  {
    sport: "ncaam",
    higherSeed: 1,
    lowerSeed: 16,
    round: 1,
    higherSeedWinRate: 0.99,
    lowerSeedWinRate: 0.01,
    upsetRate: 0.01,
    sampleSize: 150,
  },
  {
    sport: "ncaam",
    higherSeed: 2,
    lowerSeed: 15,
    round: 1,
    higherSeedWinRate: 0.94,
    lowerSeedWinRate: 0.06,
    upsetRate: 0.06,
    sampleSize: 150,
  },
  {
    sport: "ncaam",
    higherSeed: 3,
    lowerSeed: 14,
    round: 1,
    higherSeedWinRate: 0.84,
    lowerSeedWinRate: 0.16,
    upsetRate: 0.16,
    sampleSize: 150,
  },
  {
    sport: "ncaam",
    higherSeed: 4,
    lowerSeed: 13,
    round: 1,
    higherSeedWinRate: 0.79,
    lowerSeedWinRate: 0.21,
    upsetRate: 0.21,
    sampleSize: 150,
  },
  {
    sport: "ncaam",
    higherSeed: 5,
    lowerSeed: 12,
    round: 1,
    higherSeedWinRate: 0.64,
    lowerSeedWinRate: 0.36,
    upsetRate: 0.36,
    sampleSize: 150,
  },
  {
    sport: "ncaam",
    higherSeed: 6,
    lowerSeed: 11,
    round: 1,
    higherSeedWinRate: 0.62,
    lowerSeedWinRate: 0.38,
    upsetRate: 0.38,
    sampleSize: 150,
  },
]

function lookupSeedHistory(args: {
  higherSeed: number | null
  lowerSeed: number | null
  round: number
}): SeedHistoryMetric | null {
  if (args.higherSeed == null || args.lowerSeed == null) return null
  const { higherSeed, lowerSeed, round } = args
  const byRound = SEED_HISTORY.find(
    (m) =>
      m.round === round &&
      m.higherSeed === higherSeed &&
      m.lowerSeed === lowerSeed
  )
  if (byRound) return byRound
  const anyRound = SEED_HISTORY.find(
    (m) => m.higherSeed === higherSeed && m.lowerSeed === lowerSeed
  )
  return anyRound ?? null
}

function clampProb(p: number): number {
  return Math.max(0.05, Math.min(0.95, p))
}

function labelConfidenceFromSpread(spread: number): "low" | "medium" | "high" {
  if (spread >= 0.25) return "high"
  if (spread >= 0.10) return "medium"
  return "low"
}

export function buildMatchupAnalytics(args: {
  tournamentId: string
  gameId: string
  round: number
  team1: NormalizedTeamAnalytics
  team2: NormalizedTeamAnalytics
}): MatchupAnalytics {
  const { tournamentId, gameId, round, team1, team2 } = args

  const baseWin = computeWinProbability(team1.seed, team2.seed)
  let p1 = baseWin.teamA
  let p2 = baseWin.teamB

  const keyFactors: string[] = []

  if (team1.seed != null && team2.seed != null) {
    keyFactors.push(
      `${team1.teamName} seed #${team1.seed} vs ${team2.teamName} seed #${team2.seed}`
    )
  }

  if (team1.netRating != null && team2.netRating != null) {
    const delta = team1.netRating - team2.netRating
    keyFactors.push(
      `Net rating edge: ${delta >= 0 ? team1.teamName : team2.teamName} by ~${Math.abs(
        delta
      ).toFixed(1)}`
    )
    const adjust = Math.max(-0.08, Math.min(0.08, delta / 40))
    p1 = clampProb(p1 + adjust)
    p2 = clampProb(1 - p1)
  }

  if (team1.recentForm != null && team2.recentForm != null) {
    const df = team1.recentForm - team2.recentForm
    if (Math.abs(df) >= 1) {
      keyFactors.push(
        `Recent form tilt toward ${
          df > 0 ? team1.teamName : team2.teamName
        } (last stretch)`
      )
      const adjust = Math.max(-0.05, Math.min(0.05, df / 20))
      p1 = clampProb(p1 + adjust)
      p2 = clampProb(1 - p1)
    }
  }

  if (team1.strengthOfSchedule != null && team2.strengthOfSchedule != null) {
    const ds = team1.strengthOfSchedule - team2.strengthOfSchedule
    if (Math.abs(ds) >= 1) {
      keyFactors.push(
        `Schedule strength edge toward ${
          ds > 0 ? team1.teamName : team2.teamName
        }`
      )
      const adjust = Math.max(-0.03, Math.min(0.03, ds / 50))
      p1 = clampProb(p1 + adjust)
      p2 = clampProb(1 - p1)
    }
  }

  const seedHistory = lookupSeedHistory({
    higherSeed:
      team1.seed != null && team2.seed != null
        ? Math.min(team1.seed, team2.seed)
        : null,
    lowerSeed:
      team1.seed != null && team2.seed != null
        ? Math.max(team1.seed, team2.seed)
        : null,
    round,
  })

  if (seedHistory) {
    keyFactors.push(
      `Historical seed matchup: higher seed has won roughly ${Math.round(
        seedHistory.higherSeedWinRate * 100
      )}% of similar games.`
    )
  }

  const upsetBase =
    seedHistory?.upsetRate != null ? seedHistory.upsetRate : 0.2

  const favorite: "team1" | "team2" | null =
    p1 > p2 + 0.02 ? "team1" : p2 > p1 + 0.02 ? "team2" : null

  const upsetProbability =
    favorite === "team1"
      ? clampProb(upsetBase + (1 - p1) * 0.5)
      : favorite === "team2"
      ? clampProb(upsetBase + (1 - p2) * 0.5)
      : clampProb(upsetBase + 0.1)

  const spread = Math.abs(p1 - p2)
  const confidenceLabel = labelConfidenceFromSpread(spread)

  const favoriteTeamId =
    favorite === "team1"
      ? team1.teamId
      : favorite === "team2"
      ? team2.teamId
      : null

  const freshnessTimestamp = new Date().toISOString()

  return {
    tournamentId,
    gameId,
    round,
    team1,
    team2,
    probabilityTeam1: p1,
    probabilityTeam2: p2,
    upsetProbability,
    favoriteTeamId,
    confidenceLabel,
    keyFactors,
    freshnessTimestamp,
  }
}

type RandomFn = () => number

function createSeededRng(seed: number): RandomFn {
  // Simple mulberry32 PRNG for deterministic simulations
  let t = seed >>> 0
  return () => {
    t += 0x6D2B79F5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export function simulateSingleTournament(args: {
  nodes: BracketNodeLite[]
  probabilities: NodeProbabilityMap
  rng?: RandomFn
}): { winnersByNode: Record<string, string | null> } {
  const { nodes, probabilities, rng } = args
  const random: RandomFn = rng ?? Math.random
  const winnersByNode: Record<string, string | null> = {}
  const sorted = [...nodes].sort((a, b) => a.round - b.round)

  for (const node of sorted) {
    const prob = probabilities[node.id]
    const home = node.homeTeamName
    const away = node.awayTeamName

    if (!home && !away) {
      winnersByNode[node.id] = null
      continue
    }

    if (!prob) {
      const r = random()
      winnersByNode[node.id] = r <= 0.5 ? home : away
      continue
    }

    const r = random()
    const winner = r <= prob.pHome ? home : away
    winnersByNode[node.id] = winner ?? null

    if (node.nextNodeId && node.nextNodeSide && winner) {
      const next = nodes.find((n) => n.id === node.nextNodeId)
      if (next) {
        if (node.nextNodeSide === "home") {
          next.homeTeamName = winner
        } else {
          next.awayTeamName = winner
        }
      }
    }
  }

  return { winnersByNode }
}

export function simulateEntryRankDistribution(args: {
  simulations: number
  nodes: BracketNodeLite[]
  probabilities: NodeProbabilityMap
  entryIds: string[]
  scoreEntry: (entryId: string, winnersByNode: Record<string, string | null>) => number
  targetEntryId: string
  tournamentId: string
  seed?: number
}): BracketSimulationSummary {
  const {
    simulations,
    nodes,
    probabilities,
    entryIds,
    scoreEntry,
    targetEntryId,
    tournamentId,
    seed,
  } = args

  const baseSeed =
    typeof seed === "number" && Number.isFinite(seed) ? Math.floor(seed) : Math.floor(Date.now() % 2_147_483_647)

  const ranks: number[] = []
  const finalFourFrequency: Record<string, number> = {}
  const championshipFrequency: Record<string, number> = {}

  let winCount = 0
  let top5Count = 0
  let rankSum = 0

  for (let i = 0; i < simulations; i++) {
    const rng = createSeededRng(baseSeed + i + 1)
    const runNodes = nodes.map((n) => ({ ...n }))
    const { winnersByNode } = simulateSingleTournament({
      nodes: runNodes,
      probabilities,
      rng,
    })

    const scores: { entryId: string; score: number }[] = []
    for (const id of entryIds) {
      scores.push({ entryId: id, score: scoreEntry(id, winnersByNode) })
    }
    scores.sort((a, b) => b.score - a.score)

    const rank = scores.findIndex((s) => s.entryId === targetEntryId) + 1
    ranks.push(rank)
    rankSum += rank
    if (rank === 1) winCount++
    if (rank <= 5) top5Count++

    const championshipNode = runNodes.find((n) => n.round === 6)
    const champ = championshipNode ? winnersByNode[championshipNode.id] : null
    if (champ) {
      championshipFrequency[champ] = (championshipFrequency[champ] || 0) + 1
    }

    const finalFourNodes = runNodes.filter((n) => n.round === 5)
    for (const n of finalFourNodes) {
      const w = winnersByNode[n.id]
      if (w) {
        finalFourFrequency[w] = (finalFourFrequency[w] || 0) + 1
      }
    }
  }

  const simulationsCount = simulations || 1
  const winLeagueProbability = winCount / simulationsCount
  const top5Probability = top5Count / simulationsCount
  const expectedRank = rankSum / simulationsCount

  const normalizeFreq = (freq: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const [team, count] of Object.entries(freq)) {
      out[team] = count / simulationsCount
    }
    return out
  }

  return {
    tournamentId,
    entryId: targetEntryId,
    simulations: simulationsCount,
    winLeagueProbability,
    top5Probability,
    expectedRank,
    finalFourFrequency: normalizeFreq(finalFourFrequency),
    championshipFrequency: normalizeFreq(championshipFrequency),
  }
}

