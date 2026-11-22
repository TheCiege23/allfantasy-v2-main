import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"
import {
  computeWinProbability,
  computePickDistribution,
  computeSleeperScore,
  computeLeverage,
  type PickDistribution,
} from "@/lib/brackets/intelligence/data-engine"
import {
  recommendPick,
  DEFAULT_RISK_PROFILE,
  type RiskProfile,
} from "@/lib/brackets/intelligence/strategy-engine"
import { narrateMatchup } from "@/lib/brackets/intelligence/ai-narrator"
import { runBracketAiOrchestration } from "@/lib/ai/bracket-orchestrator"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ConfidenceLabel = "low" | "medium" | "high"

function labelConfidence(conf: number): ConfidenceLabel {
  if (conf >= 70) return "high"
  if (conf >= 55) return "medium"
  return "low"
}

function buildStructuredAnalysis(args: {
  teamA: string
  teamB: string
  seedA: number | null
  seedB: number | null
  round: number
  winProb: { teamA: number; teamB: number }
  dist?: PickDistribution | null
  sleeper?: { team: string; label: "high_upset" | "moderate_upset" | "slight_edge" | "none" } | null
}) {
  const { teamA, teamB, seedA, seedB, round, winProb, dist, sleeper } = args

  const keyFactors: string[] = []

  if (seedA != null && seedB != null) {
    keyFactors.push(`${teamA} is seed #${seedA}; ${teamB} is seed #${seedB}.`)
    const gap = Math.abs(seedA - seedB)
    if (gap >= 8) {
      keyFactors.push("Large seed gap; higher seed is usually favored in these spots.")
    } else if (gap >= 4) {
      keyFactors.push("Moderate seed gap; underdog has some room for an upset.")
    } else {
      keyFactors.push("Seeds are relatively close; this often comes down to small edges.")
    }
  } else {
    keyFactors.push("Seed information is incomplete for this matchup.")
  }

  if (dist && dist.total > 0) {
    const picksA = dist.picks[teamA] ?? 0
    const picksB = dist.picks[teamB] ?? 0
    const pctA = dist.total > 0 ? Math.round((picksA / dist.total) * 100) : 0
    const pctB = dist.total > 0 ? Math.round((picksB / dist.total) * 100) : 0
    keyFactors.push(
      `In this pool, about ${pctA}% of entries are on ${teamA} and about ${pctB}% are on ${teamB}.`
    )
  }

  if (sleeper && sleeper.label !== "none") {
    if (sleeper.label === "high_upset") {
      keyFactors.push(
        `${sleeper.team} shows strong underdog signals based on seed gap and low public pick rate.`
      )
    } else if (sleeper.label === "moderate_upset") {
      keyFactors.push(
        `${sleeper.team} has moderate upset indicators worth a closer look.`
      )
    } else if (sleeper.label === "slight_edge") {
      keyFactors.push(
        `${sleeper.team} has a slight underdog edge in the current inputs.`
      )
    }
  }

  if (round >= 4) {
    keyFactors.push(
      "Deeper rounds raise the impact of each pick; small differences can matter more."
    )
  }

  let numericConfidence: number
  if (seedA != null && seedB != null) {
    const gap = Math.abs(seedA - seedB)
    numericConfidence = Math.max(45, Math.min(80, 55 + gap * 2))
  } else {
    const spread = Math.abs(winProb.teamA - winProb.teamB)
    numericConfidence = spread >= 0.2 ? 70 : spread >= 0.08 ? 60 : 50
  }
  const confidenceLabel = labelConfidence(numericConfidence)

  let suggestedLean = "This matchup appears very close based on the current inputs."
  if (winProb.teamA > winProb.teamB + 0.06) {
    suggestedLean = `Based on current indicators, there is a slight lean toward ${teamA}.`
  } else if (winProb.teamB > winProb.teamA + 0.06) {
    suggestedLean = `Based on current indicators, there is a slight lean toward ${teamB}.`
  }

  let upsetWatch = "No strong upset signal from the current inputs."
  if (sleeper?.label === "slight_edge") {
    upsetWatch = "Possible upset watch — the underdog shows a small edge in current signals."
  } else if (sleeper?.label === "moderate_upset") {
    upsetWatch = "Moderate upset potential — the underdog’s indicators are more noticeable here."
  } else if (sleeper?.label === "high_upset") {
    upsetWatch = "Higher-than-usual upset risk — the underdog has strong signals worth consideration."
  }

  const analysis =
    `Matchup between ${teamA} and ${teamB}. ` +
    "These insights are meant to help you weigh the matchup — they are not guarantees about how the game will play out."

  const dataNotes =
    "This analysis uses bracket seeds and current pool pick distribution. It does not include live injury reports or detailed team efficiency stats."

  return {
    analysis,
    keyFactors,
    suggestedLean,
    confidenceLabel,
    confidenceScore: Math.round(numericConfidence),
    upsetWatch,
    dataNotes,
  }
}

export async function POST(req: Request) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({} as any))
  const { teamA, teamB, round, seedA, seedB, nodeId, tournamentId, withNarrative } = body

  if (!teamA || !teamB) {
    return NextResponse.json({ error: "Missing teamA or teamB" }, { status: 400 })
  }

  const winProb = computeWinProbability(seedA ?? null, seedB ?? null)

  let pickDistribution: { publicPctA: number; publicPctB: number } | null = null
  let dist: PickDistribution | null = null
  let advisoryOnly = false
  let leverage: any = null
  let sleeper: any = null
  let strategy: any = null
  let aiNarrative: string | undefined
  let providersMeta:
    | { openai: "ok" | "error" | "skipped"; deepseek: "ok" | "error" | "skipped"; grok: "ok" | "error" | "skipped" }
    | undefined

  if (tournamentId && nodeId) {
    const tournament = await prisma.bracketTournament.findUnique({
      where: { id: String(tournamentId) },
      select: { lockAt: true },
    })
    advisoryOnly = Boolean(tournament?.lockAt && new Date(tournament.lockAt) <= new Date())
    const distributions = await computePickDistribution(tournamentId, [nodeId])
    dist = distributions.get(nodeId) ?? null

    if (dist) {
      const totalPicks = dist.total
      const pctA = totalPicks > 0 ? (dist.picks[teamA] ?? 0) / totalPicks : 0.5
      const pctB = totalPicks > 0 ? (dist.picks[teamB] ?? 0) / totalPicks : 0.5

      pickDistribution = {
        publicPctA: Math.round(pctA * 100) / 100,
        publicPctB: Math.round(pctB * 100) / 100,
      }

      leverage = computeLeverage(
        nodeId,
        teamA,
        teamB,
        { ...dist, publicPctA: pctA, publicPctB: pctB },
        round ?? 1
      )

      const sleeperA = computeSleeperScore(teamA, seedA ?? null, seedB ?? null, pctA)
      const sleeperB = computeSleeperScore(teamB, seedB ?? null, seedA ?? null, pctB)
      sleeper = sleeperA.score > sleeperB.score ? sleeperA : sleeperB.score > 0 ? sleeperB : null

      const savedProfile = await prisma.bracketRiskProfile.findUnique({
        where: { userId: auth.userId },
      })
      const profile: RiskProfile = savedProfile
        ? {
            riskTolerance: savedProfile.riskTolerance as RiskProfile["riskTolerance"],
            poolCount: savedProfile.poolCount,
            poolSizeEstimate: savedProfile.poolSizeEstimate,
            goal: savedProfile.goal as RiskProfile["goal"],
          }
        : DEFAULT_RISK_PROFILE

      strategy = recommendPick(
        teamA, teamB,
        seedA ?? null, seedB ?? null,
        pctA, pctB,
        profile, round ?? 1
      )

      if (withNarrative) {
        aiNarrative = await narrateMatchup({
          teamA,
          teamB,
          winProbA: winProb.teamA,
          winProbB: winProb.teamB,
          publicPickPctA: pctA,
          publicPickPctB: pctB,
          seedA: seedA ?? null,
          seedB: seedB ?? null,
          round: round ?? 1,
          leverageScore: leverage.score,
        })
      }
    }
  }

  const structured = buildStructuredAnalysis({
    teamA,
    teamB,
    seedA: seedA ?? null,
    seedB: seedB ?? null,
    round: round ?? 1,
    winProb,
    dist,
    sleeper: sleeper ? { team: sleeper.team, label: sleeper.label } : null,
  })

  // Optional orchestration: DeepSeek + Grok + OpenAI, with safe fallback to deterministic analysis.
  try {
    if (tournamentId && nodeId) {
      const orchestrated = await runBracketAiOrchestration({
        tournamentId: String(tournamentId),
        nodeId: String(nodeId),
        teamA,
        teamB,
        seedA: seedA ?? null,
        seedB: seedB ?? null,
        round: round ?? 1,
        region: dist?.nodeId ? (null as any) : null, // region is not part of PickDistribution; omitted here
        winProbA: winProb.teamA,
        winProbB: winProb.teamB,
        poolPickPctA: pickDistribution?.publicPctA ?? null,
        poolPickPctB: pickDistribution?.publicPctB ?? null,
        sleeperLabel: sleeper?.label ?? null,
        generatedAtIso: new Date().toISOString(),
      })
      if (orchestrated) {
        providersMeta = orchestrated.providers
        // Override structured fields with orchestrated values while preserving existing numeric winProb etc.
        structured.analysis = orchestrated.analysis
        structured.keyFactors = orchestrated.keyFactors
        structured.suggestedLean = orchestrated.suggestedLean
        structured.confidenceLabel = orchestrated.confidenceLabel
        structured.confidenceScore = orchestrated.confidenceScore
        structured.upsetWatch = orchestrated.upsetWatch
        structured.dataNotes = orchestrated.dataNotes
      }
    }
  } catch {
    // If orchestration fails, we quietly fall back to deterministic structured analysis.
  }

  return NextResponse.json({
    ok: true,
    nodeId,
    teamA,
    teamB,
    round: round ?? 1,
    winProbability: {
      home: Math.round(winProb.teamA * 100),
      away: Math.round(winProb.teamB * 100),
    },
    pickDistribution,
    leverage,
    sleeper,
    strategy,
    analysis: structured.analysis,
    keyFactors: structured.keyFactors,
    suggestedLean: structured.suggestedLean,
    confidenceLabel: structured.confidenceLabel,
    confidence: structured.confidenceScore,
    upsetWatch: structured.upsetWatch,
    dataNotes: structured.dataNotes,
    providers: providersMeta,
    aiNarrative,
    lastUpdated: new Date().toISOString(),
    dataDisclaimer:
      "These insights are based on bracket seeds and current pool pick distribution. They are not guarantees of any outcome.",
    advisoryOnly,
    note: advisoryOnly
      ? "Tournament is locked. Chimmy output is advisory-only and intended to support your decisions, not replace them."
      : undefined,
  })
}

