import { prisma } from "@/lib/prisma"
import { computeHealthScore } from "@/lib/brackets/intelligence/data-engine"

type LiveGameStatus = "scheduled" | "in_progress" | "final" | "unknown"

export type LiveGameSummary = {
  id: string
  round: number
  region: string | null
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: LiveGameStatus
  isUpsetWatch: boolean
  upsetProbability: number | null
  momentumScore: number | null
}

type LeaderboardSnapshot = {
  currentRank: number
  totalEntries: number
}

type SurvivalSummary = {
  survivalProbability: number
  alivePct: number
  championAlive: boolean
  maxPossiblePoints: number
  currentPoints: number
}

type ChampionPathNode = {
  round: number
  opponentName: string | null
}

type LiveBracketIntel = {
  entryId: string
  tournamentId: string
  liveGames: LiveGameSummary[]
  upsetAlerts: LiveGameSummary[]
  survival: SurvivalSummary
  leaderboard: LeaderboardSnapshot
  championPath: ChampionPathNode[]
}

function normalizeTeamName(value: string | null | undefined): string {
  if (!value) return ""
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim()
}

function mapStatus(raw?: string | null): LiveGameStatus {
  if (!raw) return "unknown"
  const s = raw.toLowerCase()
  if (s.includes("progress") || s.includes("live")) return "in_progress"
  if (s.includes("final") || s === "ft") return "final"
  if (s.includes("sched") || s.includes("not started")) return "scheduled"
  return "unknown"
}

export async function getLiveBracketIntel(entryId: string): Promise<LiveBracketIntel | null> {
  const entry = await prisma.bracketEntry.findUnique({
    where: { id: entryId },
    include: {
      league: {
        select: {
          id: true,
          tournamentId: true,
        },
      },
      picks: {
        select: {
          nodeId: true,
          pickedTeamName: true,
          isCorrect: true,
          points: true,
        },
      },
    },
  })

  if (!entry || !entry.league) return null
  const tournamentId = entry.league.tournamentId

  const [nodes, health] = await Promise.all([
    prisma.bracketNode.findMany({
      where: { tournamentId },
      select: {
        id: true,
        round: true,
        region: true,
        homeTeamName: true,
        awayTeamName: true,
        seedHome: true,
        seedAway: true,
      },
    }),
    computeHealthScore(entry.id, tournamentId),
  ])

  const teamSet = new Set<string>()
  for (const n of nodes) {
    if (n.homeTeamName) teamSet.add(n.homeTeamName)
    if (n.awayTeamName) teamSet.add(n.awayTeamName)
  }

  const normalizedToCanonical = new Map<string, string>()
  for (const t of teamSet) {
    normalizedToCanonical.set(normalizeTeamName(t), t)
  }

  const liveGamesDb = await prisma.sportsGame.findMany({
    where: {
      sport: "ncaam",
      OR: [
        { status: { contains: "in_progress" } },
        { status: { contains: "live" } },
        { status: { contains: "final" } },
      ],
    },
    select: {
      id: true,
      homeTeam: true,
      awayTeam: true,
      homeScore: true,
      awayScore: true,
      status: true,
    },
  })

  const liveGames: LiveGameSummary[] = []

  for (const node of nodes) {
    const home = node.homeTeamName
    const away = node.awayTeamName
    if (!home || !away) continue

    const nh = normalizeTeamName(home)
    const na = normalizeTeamName(away)

    const game = liveGamesDb.find((g) => {
      const gh = normalizeTeamName(g.homeTeam)
      const ga = normalizeTeamName(g.awayTeam)
      return (gh === nh && ga === na) || (gh === na && ga === nh)
    })

    if (!game) continue

    const status = mapStatus(game.status)
    const homeScore = game.homeScore ?? null
    const awayScore = game.awayScore ?? null

    const isInProgress = status === "in_progress"
    const seedHome = (node as any).seedHome as number | null | undefined
    const seedAway = (node as any).seedAway as number | null | undefined
    let isUpsetWatch = false
    let upsetProbability: number | null = null
    let momentumScore: number | null = null

    if (
      isInProgress &&
      seedHome != null &&
      seedAway != null &&
      homeScore != null &&
      awayScore != null
    ) {
      const lowerSeedHome = seedHome > seedAway
      if (lowerSeedHome && homeScore > awayScore) isUpsetWatch = true
      if (!lowerSeedHome && awayScore > homeScore && seedAway > seedHome) isUpsetWatch = true

      // Simple live upset probability model
      const totalPoints = Math.max(homeScore, awayScore)
      const progress = Math.min(1, totalPoints / 80) // rough game progression proxy
      const scoreDiff = (homeScore - awayScore) * (lowerSeedHome ? 1 : -1)
      const baseUpset =
        seedHome > seedAway
          ? 0.2 + (seedHome - seedAway) * 0.03
          : 0.2 + (seedAway - seedHome) * 0.03
      const leadEffect = 0.15 * Math.tanh(scoreDiff / 8)
      const timeFactor = 0.5 + 0.5 * progress
      const raw = baseUpset * timeFactor + leadEffect
      upsetProbability = Math.max(0.01, Math.min(0.99, raw))

      const pctDiff =
        homeScore + awayScore > 0
          ? Math.abs(homeScore - awayScore) / Math.max(homeScore, awayScore)
          : 0
      momentumScore = Math.max(0, Math.min(1, pctDiff * timeFactor))
    }

    liveGames.push({
      id: node.id,
      round: node.round,
      region: node.region,
      homeTeam: home,
      awayTeam: away,
      homeScore,
      awayScore,
      status,
      isUpsetWatch,
      upsetProbability,
      momentumScore,
    })
  }

  const upsetAlerts = liveGames.filter((g) => g.isUpsetWatch)

  const championPick = entry.picks.find(
    (p) =>
      nodes.find((n) => n.id === p.nodeId && n.round === 6) &&
      p.pickedTeamName != null
  )?.pickedTeamName

  const championAlive = health.championAlive

  const rankFactor =
    health.totalEntries > 1
      ? 1 - (health.currentRank - 1) / Math.max(health.totalEntries - 1, 1)
      : 1
  const aliveFactor = health.alivePct
  const riskFactor = 1 - (health.riskExposure || 0)

  let survivalProbability = 0.5 * aliveFactor + 0.3 * rankFactor + 0.2 * riskFactor
  survivalProbability = Math.max(0, Math.min(1, survivalProbability))

  const leaderboard: LeaderboardSnapshot = {
    currentRank: health.currentRank,
    totalEntries: health.totalEntries,
  }

  const championPath: ChampionPathNode[] = []
  if (championPick) {
    const rounds = [2, 3, 4, 5, 6]
    for (const r of rounds) {
      const nodeForRound = nodes.find(
        (n) =>
          n.round === r &&
          (n.homeTeamName === championPick || n.awayTeamName === championPick)
      )
      if (!nodeForRound) continue
      const opponent =
        nodeForRound.homeTeamName === championPick
          ? nodeForRound.awayTeamName
          : nodeForRound.homeTeamName
      championPath.push({
        round: r,
        opponentName: opponent ?? null,
      })
    }
  }

  return {
    entryId: entry.id,
    tournamentId,
    liveGames,
    upsetAlerts,
    survival: {
      survivalProbability,
      alivePct: health.alivePct,
      championAlive,
      maxPossiblePoints: health.maxPossiblePoints,
      currentPoints: health.currentPoints,
    },
    leaderboard,
    championPath,
  }
}

