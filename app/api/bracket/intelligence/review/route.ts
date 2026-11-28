import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireVerifiedUser } from "@/lib/auth-guard"
import { getEntryBracketData } from "@/lib/brackets/getEntryBracketData"
import { computePickDistribution, computeBracketUniqueness } from "@/lib/brackets/intelligence/data-engine"
import { openaiChatJson, parseJsonContentFromChatCompletion } from "@/lib/openai-client"
import { aiCostGate } from "@/lib/ai-protection/costGate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type BracketReviewMetrics = {
  entryId: string
  tournamentId: string
  leagueId: string
  totalPicks: number
  totalUpsets: number
  upsetRate: number
  upsetsByRound: Record<number, number>
  picksByRound: Record<number, number>
  picksByRegion: Record<string, number>
  uniqueness: {
    score: number
    percentile: number | null
  }
  champion: {
    pick: string | null
    popularity: { team: string; pct: number } | null
  }
  riskScore?: number
}

export async function POST(req: Request) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => ({}))
  const entryId = String(body.entryId || "")

  if (!entryId) {
    return NextResponse.json({ error: "Missing entryId" }, { status: 400 })
  }

  const entry = await prisma.bracketEntry.findUnique({
    where: { id: entryId },
    include: {
      league: { select: { id: true, tournamentId: true } },
      picks: { select: { nodeId: true, pickedTeamName: true } },
    },
  })

  if (!entry || entry.userId !== auth.userId) {
    return NextResponse.json({ error: "Entry not found or forbidden" }, { status: 403 })
  }

  const tournamentId = entry.league.tournamentId

  const [{ nodesWithGame }, distributions] = await Promise.all([
    getEntryBracketData(tournamentId, entryId),
    computePickDistribution(tournamentId),
  ])

  const validPicks = entry.picks.filter((p) => p.pickedTeamName != null) as Array<{
    nodeId: string
    pickedTeamName: string
  }>
  const uniqueness = computeBracketUniqueness(validPicks, distributions)

  const nodeById = new Map(nodesWithGame.map((n) => [n.id, n]))

  let totalUpsets = 0
  let totalPicks = 0
  const upsetsByRound: Record<number, number> = {}
  const picksByRound: Record<number, number> = {}
  const picksByRegion: Record<string, number> = {}

  for (const pick of validPicks) {
    const node = nodeById.get(pick.nodeId)
    if (!node) continue
    const round = node.round
    const region = node.region || "Unknown"
    picksByRound[round] = (picksByRound[round] || 0) + 1
    picksByRegion[region] = (picksByRegion[region] || 0) + 1
    totalPicks++

    const pickedSeed =
      pick.pickedTeamName === node.homeTeamName ? node.seedHome : node.seedAway
    const opponentSeed =
      pick.pickedTeamName === node.homeTeamName ? node.seedAway : node.seedHome
    if (
      pickedSeed != null &&
      opponentSeed != null &&
      pickedSeed > opponentSeed
    ) {
      totalUpsets++
      upsetsByRound[round] = (upsetsByRound[round] || 0) + 1
    }
  }

  const upsetRate = totalPicks > 0 ? totalUpsets / totalPicks : 0

  const championshipNodes = nodesWithGame.filter((n) => n.round === 6)
  const championshipNodeIds = new Set(championshipNodes.map((n) => n.id))

  let championPick: string | null = null
  for (const p of validPicks) {
    if (championshipNodeIds.has(p.nodeId)) {
      championPick = p.pickedTeamName
      break
    }
  }

  let championPopularity: { team: string; pct: number } | null = null
  if (championPick && championshipNodes.length > 0) {
    const champNodeId = championshipNodes[0].id
    const dist = distributions.get(champNodeId)
    if (dist && dist.total > 0) {
      const count = dist.picks[championPick] ?? 0
      championPopularity = {
        team: championPick,
        pct: Math.round((count / dist.total) * 1000) / 10,
      }
    }
  }

  const metrics: BracketReviewMetrics = {
    entryId,
    tournamentId,
    leagueId: entry.league.id,
    totalPicks,
    totalUpsets,
    upsetRate,
    upsetsByRound,
    picksByRound,
    picksByRegion,
    uniqueness: {
      score: uniqueness.score,
      percentile: uniqueness.percentile,
    },
    champion: {
      pick: championPick,
      popularity: championPopularity,
    },
  }

  // Simple deterministic risk score (0–100) based on upset rate, uniqueness, and champion popularity.
  let riskScore = 50
  const upsetComponent = (upsetRate - 0.2) * 100 * 0.4
  riskScore += upsetComponent
  if (uniqueness.percentile != null) {
    const uniquenessComponent = (100 - uniqueness.percentile) * 0.2
    riskScore += uniquenessComponent
  }
  if (championPopularity?.pct != null) {
    if (championPopularity.pct < 20) {
      riskScore += 10
    } else if (championPopularity.pct > 50) {
      riskScore -= 5
    }
  }
  metrics.riskScore = Math.max(0, Math.min(100, Math.round(riskScore)))

  let aiReview: {
    strengths: string[]
    risks: string[]
    strategyNotes: string[]
    summary: string
  } | null = null

  // Owner, 2026-11-28: every model call is signed in and capped. The metrics above are deterministic; the
  // daily cap is taken immediately before the review model call.
  const capped = await aiCostGate(req, "bracket_review_ai", auth.userId)
  if (capped) return capped

  try {
    const res = await openaiChatJson({
      messages: [
        {
          role: "system",
          content: [
            "You are an NCAA bracket analysis assistant.",
            "You help users understand the strengths, risks, and strategic traits of their bracket.",
            "You MUST NOT promise wins, guarantees, or 'best' brackets.",
            "Only describe risk distribution, upset exposure, uniqueness, and alignment with typical outcomes.",
            "",
            "You must respond with ONLY a single JSON object with this shape:",
            '{ "strengths": string[], "risks": string[], "strategyNotes": string[], "summary": string }',
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(metrics, null, 2),
        },
      ],
      temperature: 0.4,
      maxTokens: 900,
    })

    if (res.ok) {
      const parsed = parseJsonContentFromChatCompletion(res.json)
      if (parsed && typeof parsed === "object") {
        aiReview = {
          strengths: Array.isArray(parsed.strengths)
            ? parsed.strengths.filter((s: any) => typeof s === "string")
            : [],
          risks: Array.isArray(parsed.risks)
            ? parsed.risks.filter((s: any) => typeof s === "string")
            : [],
          strategyNotes: Array.isArray(parsed.strategyNotes)
            ? parsed.strategyNotes.filter((s: any) => typeof s === "string")
            : [],
          summary:
            typeof parsed.summary === "string"
              ? parsed.summary
              : "This bracket has a mix of strengths and potential risks worth reviewing.",
        }
      }
    }
  } catch {
    aiReview = null
  }

  return NextResponse.json({
    ok: true,
    entryId,
    metrics,
    aiReview,
    note:
      "This analysis highlights bracket strengths, risks, and uniqueness. It is not a guarantee of any outcome.",
  })
}

