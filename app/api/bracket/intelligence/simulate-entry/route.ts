import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"
import { simulateEntryRankDistribution, type BracketNodeLite, type NodeProbabilityMap } from "@/lib/brackets/analytics"
import { computeWinProbability } from "@/lib/brackets/intelligence/data-engine"
import { scoreEntry, type ScoringMode, bonusFlagsFromRules, type BonusFlags, type PickResult, type LeaguePickDistribution } from "@/lib/brackets/scoring"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_SIMULATIONS = 5000
const DEFAULT_SIMULATIONS = 2000

function buildNodeProbabilities(nodes: BracketNodeLite[]): NodeProbabilityMap {
  const map: NodeProbabilityMap = {}
  for (const n of nodes) {
    const seedHome = (n as any).seedHome as number | null | undefined
    const seedAway = (n as any).seedAway as number | null | undefined
    const base = computeWinProbability(seedHome ?? null, seedAway ?? null)
    map[n.id] = { pHome: base.teamA, pAway: base.teamB }
  }
  return map
}

function normalizeRoundPoints(input: unknown): Record<number, number> | undefined {
  if (!input || typeof input !== "object") return undefined
  const out: Record<number, number> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const round = Number(k)
    const value = Number(v)
    if (Number.isFinite(round) && Number.isFinite(value) && round >= 1 && round <= 6) {
      out[round] = Math.max(0, value)
    }
  }
  return Object.keys(out).length ? out : undefined
}

export async function POST(req: Request) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const entryId = String(body.entryId || "")
  const requestedIterations = Number(body.simulations || body.iterations || DEFAULT_SIMULATIONS)
  const simulations = Math.max(200, Math.min(MAX_SIMULATIONS, Number.isFinite(requestedIterations) ? requestedIterations : DEFAULT_SIMULATIONS))
  const seed = body.seed != null ? Number(body.seed) : undefined

  if (!entryId) {
    return NextResponse.json({ error: "Missing entryId" }, { status: 400 })
  }

  const entry = await prisma.bracketEntry.findUnique({
    where: { id: entryId },
    include: {
      league: {
        select: {
          id: true,
          tournamentId: true,
          scoringRules: true,
        },
      },
    },
  })

  if (!entry || entry.userId !== auth.userId) {
    return NextResponse.json({ error: "Entry not found or forbidden" }, { status: 403 })
  }

  const tournamentId = entry.league.tournamentId
  const leagueId = entry.league.id

  const [nodesDb, allEntries] = await Promise.all([
    prisma.bracketNode.findMany({
      where: { tournamentId },
      select: {
        id: true,
        round: true,
        homeTeamName: true,
        awayTeamName: true,
        seedHome: true,
        seedAway: true,
        nextNodeId: true,
        nextNodeSide: true,
      },
    }),
    prisma.bracketEntry.findMany({
      where: { leagueId },
      include: {
        picks: {
          select: { nodeId: true, pickedTeamName: true },
        },
      },
    }),
  ])

  if (!nodesDb.length || !allEntries.length) {
    return NextResponse.json({ error: "No bracket data available for simulation" }, { status: 400 })
  }

  const nodes: BracketNodeLite[] = nodesDb.map((n: any) => ({
    id: n.id,
    round: n.round,
    homeTeamName: n.homeTeamName,
    awayTeamName: n.awayTeamName,
    nextNodeId: n.nextNodeId,
    nextNodeSide: n.nextNodeSide === "HOME" || n.nextNodeSide === "AWAY" ? (n.nextNodeSide === "HOME" ? "home" : "away") : null,
  }))

  const nodeProbabilities = buildNodeProbabilities(nodesDb as any)

  const leagueMembers = allEntries.map((e) => e.id)
  const leagueDistributions: LeaguePickDistribution = {}
  for (const e of allEntries as any[]) {
    for (const p of e.picks) {
      if (!p.pickedTeamName) continue
      if (!leagueDistributions[p.nodeId]) leagueDistributions[p.nodeId] = {}
      leagueDistributions[p.nodeId][p.pickedTeamName] = (leagueDistributions[p.nodeId][p.pickedTeamName] || 0) + 1
    }
  }

  const rules = (entry.league.scoringRules || {}) as any
  const mode = (rules.scoringMode || rules.mode || "momentum") as ScoringMode
  const flags: BonusFlags = bonusFlagsFromRules(rules)
  const roundPointsOverride = normalizeRoundPoints(rules.roundPoints)

  const seedMapLocal = new Map<string, number>()
  for (const n of nodesDb) {
    if (n.round === 1) {
      if (n.homeTeamName && n.seedHome != null) seedMapLocal.set(n.homeTeamName, n.seedHome)
      if (n.awayTeamName && n.seedAway != null) seedMapLocal.set(n.awayTeamName, n.seedAway)
    }
  }

  const scoreEntryForSim = (simEntryId: string, winnersByNode: Record<string, string | null>): number => {
    const simEntry = allEntries.find((e) => e.id === simEntryId)
    if (!simEntry) return 0
    const pickResults: PickResult[] = simEntry.picks.map((p: any) => {
      const node = nodesDb.find((n) => n.id === p.nodeId)
      const round = node?.round ?? 0
      const pickedTeamName = p.pickedTeamName ?? null
      const pickedSeed = pickedTeamName ? (seedMapLocal.get(pickedTeamName) ?? null) : null
      const winnerName = winnersByNode[p.nodeId] ?? null
      const actualWinnerSeed = winnerName ? (seedMapLocal.get(winnerName) ?? null) : null
      let opponentSeed: number | null = null
      if (node && pickedTeamName) {
        const opponent = pickedTeamName === node.homeTeamName ? node.awayTeamName : node.homeTeamName
        opponentSeed = opponent ? (seedMapLocal.get(opponent) ?? null) : null
      }
      const isCorrect = winnerName && pickedTeamName ? winnerName === pickedTeamName : null
      return {
        nodeId: p.nodeId,
        round,
        pickedTeamName,
        isCorrect,
        pickedSeed,
        actualWinnerSeed,
        opponentSeed,
      }
    })
    const insuranceNodeId = flags.insuranceEnabled ? ((simEntry as any).insuredNodeId || null) : null
    const { total } = scoreEntry(mode, pickResults, leagueDistributions, insuranceNodeId, flags, roundPointsOverride)
    return total
  }

  const summary = simulateEntryRankDistribution({
    simulations,
    nodes,
    probabilities: nodeProbabilities,
    entryIds: leagueMembers,
    scoreEntry: scoreEntryForSim,
    targetEntryId: entryId,
    tournamentId,
    seed,
  })

  // Persist a snapshot for quick retrieval
  try {
    await prisma.bracketSimulationSnapshot.upsert({
      where: {
        tournamentId_leagueId_entryId: {
          tournamentId,
          leagueId,
          entryId,
        },
      },
      update: {
        simulations: summary.simulations,
        winLeagueProbability: summary.winLeagueProbability,
        top5Probability: summary.top5Probability,
        expectedRank: summary.expectedRank,
      },
      create: {
        tournamentId,
        leagueId,
        entryId,
        simulations: summary.simulations,
        winLeagueProbability: summary.winLeagueProbability,
        top5Probability: summary.top5Probability,
        expectedRank: summary.expectedRank,
      },
    })
  } catch {
    // best-effort persistence; do not fail the request
  }

  return NextResponse.json({
    ok: true,
    entryId,
    leagueId,
    simulations: summary.simulations,
    winLeagueProbability: summary.winLeagueProbability,
    top5Probability: summary.top5Probability,
    expectedRank: summary.expectedRank,
    finalFourFrequency: summary.finalFourFrequency,
    championshipFrequency: summary.championshipFrequency,
    note: "These results are simulation-based estimates using current seed-driven probabilities. They are not guarantees of any outcome.",
  })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const entryId = searchParams?.get("entryId") || ""
    const leagueIdParam = searchParams?.get("leagueId")
    const tournamentIdParam = searchParams?.get("tournamentId")

    if (!entryId) {
      return NextResponse.json({ error: "Missing entryId" }, { status: 400 })
    }

    let leagueId = leagueIdParam
    let tournamentId = tournamentIdParam

    if (!leagueId || !tournamentId) {
      const entry = await prisma.bracketEntry.findUnique({
        where: { id: entryId },
        select: {
          leagueId: true,
          league: { select: { tournamentId: true } },
        },
      })
      if (!entry) {
        return NextResponse.json({ error: "Entry not found" }, { status: 404 })
      }
      leagueId = leagueId || entry.leagueId
      tournamentId = tournamentId || entry.league.tournamentId
    }

    const snapshot = await prisma.bracketSimulationSnapshot.findUnique({
      where: {
        tournamentId_leagueId_entryId: {
          tournamentId: tournamentId!,
          leagueId: leagueId!,
          entryId,
        },
      },
    })

    if (!snapshot) {
      return NextResponse.json(
        {
          ok: false,
          cached: false,
          message: "No simulation snapshot found for this entry.",
        },
        { status: 404 },
      )
    }

    return NextResponse.json({
      ok: true,
      cached: true,
      tournamentId: snapshot.tournamentId,
      leagueId: snapshot.leagueId,
      entryId: snapshot.entryId,
      simulations: snapshot.simulations,
      winLeagueProbability: snapshot.winLeagueProbability,
      top5Probability: snapshot.top5Probability,
      expectedRank: snapshot.expectedRank,
      updatedAt: snapshot.updatedAt.toISOString(),
    })
  } catch (err: any) {
    console.error("[simulate-entry] GET snapshot error:", err)
    return NextResponse.json(
      { error: "Failed to load simulation snapshot" },
      { status: 500 },
    )
  }
}

