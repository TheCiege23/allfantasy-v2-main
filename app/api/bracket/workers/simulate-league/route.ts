import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import {
  simulateEntryRankDistribution,
  type BracketNodeLite,
  type NodeProbabilityMap,
} from "@/lib/brackets/analytics"
import { computeWinProbability } from "@/lib/brackets/intelligence/data-engine"
import {
  scoreEntry,
  type ScoringMode,
  bonusFlagsFromRules,
  type BonusFlags,
  type PickResult,
  type LeaguePickDistribution,
} from "@/lib/brackets/scoring"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_SIMULATIONS = 3000
const DEFAULT_SIMULATIONS = 1500

function buildNodeProbabilities(nodes: any[]): NodeProbabilityMap {
  const map: NodeProbabilityMap = {}
  for (const n of nodes) {
    const seedHome = n.seedHome as number | null | undefined
    const seedAway = n.seedAway as number | null | undefined
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

export async function POST(req: NextRequest) {
  // Worker endpoint: it writes tournaments, nodes, picks or feed events, so it
  // takes the same cron/admin secret as sync-playoff. It was reachable anonymously.
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const body = await req.json().catch(() => ({} as any))
    const leagueId = typeof body.leagueId === "string" ? body.leagueId.trim() : ""
    const requestedSimulations = Number(body.simulations || body.iterations || DEFAULT_SIMULATIONS)
    const simulations = Math.max(
      200,
      Math.min(MAX_SIMULATIONS, Number.isFinite(requestedSimulations) ? requestedSimulations : DEFAULT_SIMULATIONS),
    )
    const seed = body.seed != null ? Number(body.seed) : undefined

    if (!leagueId) {
      return NextResponse.json({ error: "Missing leagueId" }, { status: 400 })
    }

    const league = await prisma.bracketLeague.findUnique({
      where: { id: leagueId },
      select: {
        id: true,
        tournamentId: true,
        scoringRules: true,
      },
    })

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 })
    }

    const tournamentId = league.tournamentId

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
        where: {
          leagueId,
          status: { notIn: ["DRAFT", "INVALIDATED"] },
        },
        include: {
          picks: {
            select: { nodeId: true, pickedTeamName: true },
          },
        },
      }),
    ])

    if (!nodesDb.length || !allEntries.length) {
      return NextResponse.json({
        ok: true,
        message: "No nodes or eligible entries to simulate.",
        leagueId,
        tournamentId,
      })
    }

    const nodes: BracketNodeLite[] = nodesDb.map((n: any) => ({
      id: n.id,
      round: n.round,
      homeTeamName: n.homeTeamName,
      awayTeamName: n.awayTeamName,
      nextNodeId: n.nextNodeId,
      nextNodeSide:
        n.nextNodeSide === "HOME" || n.nextNodeSide === "AWAY"
          ? n.nextNodeSide === "HOME"
            ? "home"
            : "away"
          : null,
    }))

    const probabilities = buildNodeProbabilities(nodesDb as any)

    const entryIds = allEntries.map((e) => e.id)
    const leagueDistributions: LeaguePickDistribution = {}
    for (const e of allEntries as any[]) {
      for (const p of e.picks) {
        if (!p.pickedTeamName) continue
        if (!leagueDistributions[p.nodeId]) leagueDistributions[p.nodeId] = {}
        leagueDistributions[p.nodeId][p.pickedTeamName] =
          (leagueDistributions[p.nodeId][p.pickedTeamName] || 0) + 1
      }
    }

    const rules = (league.scoringRules || {}) as any
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
          const opponent =
            pickedTeamName === node.homeTeamName ? node.awayTeamName : node.homeTeamName
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
      const { total } = scoreEntry(
        mode,
        pickResults,
        leagueDistributions,
        insuranceNodeId,
        flags,
        roundPointsOverride,
      )
      return total
    }

    // Run one distribution per entry to get per-entry probabilities and persist snapshots
    const snapshots: {
      entryId: string
      winLeagueProbability: number
      top5Probability: number
      expectedRank: number
      simulations: number
    }[] = []

    for (const targetEntryId of entryIds) {
      const summary = simulateEntryRankDistribution({
        simulations,
        nodes,
        probabilities,
        entryIds,
        scoreEntry: scoreEntryForSim,
        targetEntryId,
        tournamentId,
        seed,
      })

      snapshots.push({
        entryId: targetEntryId,
        simulations: summary.simulations,
        winLeagueProbability: summary.winLeagueProbability,
        top5Probability: summary.top5Probability,
        expectedRank: summary.expectedRank,
      })
    }

    const tx = snapshots.map((snap) =>
      prisma.bracketSimulationSnapshot.upsert({
        where: {
          tournamentId_leagueId_entryId: {
            tournamentId,
            leagueId,
            entryId: snap.entryId,
          },
        },
        update: {
          simulations: snap.simulations,
          winLeagueProbability: snap.winLeagueProbability,
          top5Probability: snap.top5Probability,
          expectedRank: snap.expectedRank,
        },
        create: {
          tournamentId,
          leagueId,
          entryId: snap.entryId,
          simulations: snap.simulations,
          winLeagueProbability: snap.winLeagueProbability,
          top5Probability: snap.top5Probability,
          expectedRank: snap.expectedRank,
        },
      }),
    )

    if (tx.length) {
      await prisma.$transaction(tx)
    }

    return NextResponse.json({
      ok: true,
      leagueId,
      tournamentId,
      simulations,
      entriesSimulated: entryIds.length,
    })
  } catch (err: any) {
    console.error("[workers/simulate-league] Error:", err)
    return NextResponse.json(
      { error: err?.message || "League simulation worker failed" },
      { status: 500 },
    )
  }
}

