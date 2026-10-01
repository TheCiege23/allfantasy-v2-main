import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import { prisma } from "@/lib/prisma"
import { resolveWorldCupMatchViewWithEntryProjections } from "@/lib/world-cup/worldCupBracketService"
import { buildWorldCupMatchupIntelligence } from "@/lib/world-cup/worldCupAIService"
import {
  checkWcAiCap,
  incrementWcAiCap,
  resolveWcCapTier,
} from "@/lib/world-cup/worldCupAiUsageLimits"
import {
  prepareWorldCupAiTokenFallback,
  WORLD_CUP_AI_TOKEN_RULES,
} from "@/lib/world-cup/worldCupAiTokenFallback"
import type { WorldCupAiStrategy, WorldCupMatchView } from "@/lib/world-cup/types"
import {
  getWorldCupAdminState,
  requireWorldCupApiUser,
} from "../../../../../_utils"

const bodySchema = z.object({
  matchId: z.string().min(1),
  strategy: z.enum(["safe", "balanced", "upset", "chaos"]).optional().default("balanced"),
  intent: z.enum(["panel", "ask_ai", "explain"]).optional().default("panel"),
  confirmTokenSpend: z.boolean().optional().default(false),
})

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ challengeId: string; entryId: string }> }
) {
  const params = await props.params
  const userResult = await requireWorldCupApiUser()
  if (!userResult.ok) return userResult.response

  const { challengeId, entryId } = params

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const { matchId, strategy, intent } = body

  const hasBracketBrainAi = await userHasBracketBrainAi(
    userResult.user.id,
    userResult.user.email ?? null
  )
  const explicitAiIntent = intent === "ask_ai" || intent === "explain"
  const tokenAccess = explicitAiIntent
    ? await prepareWorldCupAiTokenFallback({
        userId: userResult.user.id,
        userEmail: userResult.user.email ?? null,
        entitled: hasBracketBrainAi,
        ruleCode: WORLD_CUP_AI_TOKEN_RULES.matchup,
        confirmTokenSpend: body.confirmTokenSpend,
        sourceType: "world_cup_matchup_ai",
        sourceId: `${challengeId}:${entryId}:${matchId}:${intent}:${strategy}`,
        idempotencyKey: `wc-matchup-ai:${userResult.user.id}:${challengeId}:${entryId}:${matchId}:${intent}:${strategy}`,
        description: "World Cup matchup AI analysis",
        metadata: { challengeId, entryId, matchId, intent, strategy },
        upgradePath: "/pricing?from=wc-matchup-ai",
      })
    : { ok: true as const, mode: "subscription" as const, tokenPreview: null, commitTokenSpend: null }

  if (!tokenAccess.ok) {
    return tokenAccess.response
  }

  // Daily cap for generative matchup AI (panel summary + ask_ai/explain narratives).
  // Free users are already blocked above for ask_ai/explain; this cap applies to Pro+.
  const isAdmin = await getWorldCupAdminState(req, userResult.user)
  const aiEligible = Boolean(hasBracketBrainAi || tokenAccess.mode === "tokens")
  const matchupTier = resolveWcCapTier({ isAdmin, hasPro: aiEligible })
  let capExceededForExplicit = false

  if (aiEligible) {
    const capResult = await checkWcAiCap("wc_matchup_narrative", userResult.user.id, matchupTier)
    if (!capResult.allowed) {
      // ask_ai / explain: block explicitly — user is deliberately invoking AI.
      if (intent === "ask_ai" || intent === "explain") {
        return NextResponse.json(
          {
            error: "daily_ai_limit_reached",
            message: capResult.message,
            used: capResult.used,
            limit: capResult.limit,
            resetsAt: capResult.resetsAt.toISOString(),
            upgradePath: capResult.upgradePath,
          },
          { status: 429 }
        )
      }
      // panel: soft-cap — return deterministic data rather than blocking the panel.
      capExceededForExplicit = true
    }
  }

  // If panel cap exceeded, use deterministic path (bracketBrainAiEntitled: false).
  const useGenerative = aiEligible && !capExceededForExplicit

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

  const entry = await (prisma as any).worldCupBracketEntry.findFirst({
    where: { id: entryId, challengeId, userId: userResult.user.id },
    include: {
      picks: {
        where: {
          selectedTeamName: { not: "" },
          OR: [{ selectedTeamId: { not: null } }, { selectedSlotKey: { not: null } }],
        },
        include: { match: true },
        orderBy: { createdAt: "asc" },
      },
      challenge: { include: { matches: true } },
    },
  })
  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 })
  }

  const challengeMatches = Array.isArray((entry as any)?.challenge?.matches)
    ? ((entry as any).challenge.matches as unknown[])
    : []
  const entryPicks = Array.isArray((entry as any)?.picks)
    ? ((entry as any).picks as unknown[])
    : []

  const dbMatch = await (prisma as any).worldCupBracketMatch.findFirst({
    where: { id: matchId, challengeId },
  })

  if (!dbMatch) {
    return NextResponse.json({ error: "Match not found" }, { status: 404 })
  }

  const projected =
    challengeMatches.length > 0
      ? resolveWorldCupMatchViewWithEntryProjections({
          challengeMatches: challengeMatches as any,
          entryPicks: entryPicks as any,
          matchId,
        })
      : null

  const match: WorldCupMatchView =
    projected ??
    ({
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
    } satisfies WorldCupMatchView)

  const intelligence = await buildWorldCupMatchupIntelligence({
    match,
    strategy: strategy as WorldCupAiStrategy,
    intent,
    bracketBrainAiEntitled: useGenerative,
    logContext: {
      userId: userResult.user.id,
      challengeId,
      entryId,
    },
  })

  // Increment cap only when a generative AI call was actually made.
  if (useGenerative && (intelligence.generative || intelligence.narrativesGenerative)) {
    await incrementWcAiCap("wc_matchup_narrative", userResult.user.id, matchupTier)
  }

  let tokenSpend = null
  if (tokenAccess.mode === "tokens" && (intelligence.generative || intelligence.narrativesGenerative)) {
    try {
      tokenSpend = await tokenAccess.commitTokenSpend()
    } catch {
      return NextResponse.json(
        {
          error: "Token spend failed after AI generation. No tokens were deducted.",
          code: "token_spend_failed_no_deduction",
          upgrade: true,
          upgradePath: "/tokens?ruleCode=world_cup_ai_matchup_analysis",
          preview: tokenAccess.tokenPreview,
        },
        { status: 402 }
      )
    }
  }

  return NextResponse.json({
    success: true,
    intelligence,
    tokenPreview: tokenAccess.mode === "tokens" ? tokenAccess.tokenPreview : null,
    tokenSpend,
  })
}
