import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import { prisma } from "@/lib/prisma"
import { buildWorldCupMatchupIntelligence } from "@/lib/world-cup/worldCupAIService"
import type { WorldCupAiMatchupPreview, WorldCupAiStrategy, WorldCupMatchView } from "@/lib/world-cup/types"
import { requireWorldCupApiUser } from "../../../_utils"

// ── Request schema ────────────────────────────────────────────────────────────

const bodySchema = z.object({
  entryId: z.string().optional(),
  matchId: z.string().min(1),
  strategy: z.enum(["safe", "balanced", "upset", "chaos"]).optional().default("balanced"),
})

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, props: { params: Promise<{ challengeId: string }> }) {
  const params = await props.params
  // Auth
  const userResult = await requireWorldCupApiUser()
  if (!userResult.ok) return userResult.response

  const { challengeId } = params

  // Parse body
  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { matchId, entryId, strategy } = body

  const hasBracketBrainAi = await userHasBracketBrainAi(
    userResult.user.id,
    userResult.user.email ?? null
  )

  // Challenge access
  const challenge = await (prisma as any).worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      ownerUserId: true,
      visibility: true,
      participants: {
        where: { userId: userResult.user.id },
        select: { id: true },
        take: 1,
      },
    },
  })

  if (!challenge) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 })
  }

  const isOwner = challenge.ownerUserId === userResult.user.id
  const isParticipant = challenge.participants.length > 0
  const isPublic = challenge.visibility === "public"
  if (!isOwner && !isParticipant && !isPublic) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (entryId) {
    const entry = await (prisma as any).worldCupBracketEntry.findFirst({
      where: { id: entryId, challengeId, userId: userResult.user.id },
      select: { id: true },
    })
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }
  }

  // Load match
  const dbMatch = await (prisma as any).worldCupBracketMatch.findFirst({
    where: { id: matchId, challengeId },
  })

  if (!dbMatch) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 })
  }

  // Build WorldCupMatchView-compatible shape from db record
  const match: WorldCupMatchView = {
    id: dbMatch.id,
    apiFixtureId: dbMatch.apiFixtureId ?? null,
    round: dbMatch.round,
    roundIndex: dbMatch.roundIndex,
    matchNumber: dbMatch.matchNumber,
    homeSlotKey: dbMatch.homeSlotKey,
    awaySlotKey: dbMatch.awaySlotKey,
    homeTeamId: dbMatch.homeTeamId ?? null,
    awayTeamId: dbMatch.awayTeamId ?? null,
    homeTeamName: dbMatch.homeTeamName ?? "",
    awayTeamName: dbMatch.awayTeamName ?? "",
    homeTeamLogo: dbMatch.homeTeamLogo ?? null,
    awayTeamLogo: dbMatch.awayTeamLogo ?? null,
    homeScore: dbMatch.homeScore ?? null,
    awayScore: dbMatch.awayScore ?? null,
    homePenaltyScore: dbMatch.homePenaltyScore ?? null,
    awayPenaltyScore: dbMatch.awayPenaltyScore ?? null,
    status: dbMatch.status,
    startsAt: dbMatch.startsAt ? (dbMatch.startsAt as Date).toISOString() : null,
    winnerTeamId: dbMatch.winnerTeamId ?? null,
    winnerTeamName: dbMatch.winnerTeamName ?? null,
    nextMatchId: dbMatch.nextMatchId ?? null,
    nextMatchSlot: dbMatch.nextMatchSlot ?? null,
    elapsedMinute: dbMatch.elapsedMinute ?? null,
    injuryTime: dbMatch.injuryTime ?? null,
    period: dbMatch.period ?? null,
    venueName: dbMatch.venueName ?? null,
    venueCity: dbMatch.venueCity ?? null,
    apiStatusShort: dbMatch.apiStatusShort ?? null,
    lastScoreSyncedAt: dbMatch.lastScoreSyncedAt
      ? (dbMatch.lastScoreSyncedAt as Date).toISOString()
      : null,
  }

  const intelligence = await buildWorldCupMatchupIntelligence({
    match,
    strategy: strategy as WorldCupAiStrategy,
    intent: "panel",
    bracketBrainAiEntitled: hasBracketBrainAi,
  })

  const preview: WorldCupAiMatchupPreview = {
    matchId: intelligence.matchId,
    recommendedTeamId: intelligence.recommendedTeamId,
    recommendedTeamName: intelligence.recommendedTeamName,
    recommendedSide: intelligence.recommendedSide,
    homeWinProbability: intelligence.homeWinProbability,
    awayWinProbability: intelligence.awayWinProbability,
    confidence: intelligence.confidence,
    upsetRisk: intelligence.upsetRisk,
    keyFactors: intelligence.keyFactors,
    summary: intelligence.summary,
    safePick: intelligence.safePick,
    contrarianPick: intelligence.contrarianPick,
    projectedScore: intelligence.projectedScore ?? null,
    generative: intelligence.generative,
  }

  return NextResponse.json({ success: true, preview })
}
