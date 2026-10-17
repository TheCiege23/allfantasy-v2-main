import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import { generateWorldCupBracketExplanation } from "@/lib/world-cup/worldCupExplainBracketService"
import {
  checkWcAiCap,
  incrementWcAiCap,
  resolveWcCapTier,
} from "@/lib/world-cup/worldCupAiUsageLimits"
import {
  prepareWorldCupAiTokenFallback,
  WORLD_CUP_AI_TOKEN_RULES,
} from "@/lib/world-cup/worldCupAiTokenFallback"
import { getWorldCupAdminState, requireWorldCupApiUser } from "../../../../_utils"
import { resolveLanguage } from "@/lib/i18n/constants"

export const runtime = "nodejs"

/**
 * POST: generates the private AI "Explain My Bracket" narrative.
 * GET:  returns aggregated pool-comparison data for the
 *       "What Makes My Bracket Unique?" client component.
 *
 * Both share ownership + Pro gate plumbing and live under the same route
 * file to stay within the Vercel route budget.
 */

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ challengeId: string; entryId: string }> }
) {
  const params = await props.params
  const userResult = await requireWorldCupApiUser()
  if (!userResult.ok) return userResult.response

  const { challengeId, entryId } = params
  if (!challengeId || !entryId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // AF Pro gate — return 402 with upgrade flag (consistent with commissioner-brain).
  const body = await req.json().catch(() => ({}))

  const hasBracketBrainAi = await userHasBracketBrainAi(
    userResult.user.id,
    userResult.user.email ?? null
  )
  const tokenAccess = await prepareWorldCupAiTokenFallback({
    userId: userResult.user.id,
    userEmail: userResult.user.email ?? null,
    entitled: hasBracketBrainAi,
    ruleCode: WORLD_CUP_AI_TOKEN_RULES.bracketExplanation,
    confirmTokenSpend: body?.confirmTokenSpend === true,
    sourceType: "world_cup_bracket_explanation",
    sourceId: `${challengeId}:${entryId}`,
    idempotencyKey: `wc-bracket-explain:${userResult.user.id}:${challengeId}:${entryId}`,
    description: "World Cup private bracket explanation",
    metadata: { challengeId, entryId },
    upgradePath: "/pricing?from=wc-explain",
  })
  if (!tokenAccess.ok) return tokenAccess.response

  // Daily cap — prevents unlimited AI calls per user per UTC day.
  const isAdmin = await getWorldCupAdminState(req, userResult.user)
  const tier = resolveWcCapTier({
    isAdmin,
    hasPro: Boolean(hasBracketBrainAi || tokenAccess.mode === "tokens"),
  })
  const capResult = await checkWcAiCap("explain_bracket", userResult.user.id, tier)
  if (!capResult.allowed) {
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

  const cookieStore = await cookies()
  const locale = resolveLanguage(cookieStore.get("af_lang")?.value)

  const result = await generateWorldCupBracketExplanation({
    challengeId,
    entryId,
    userId: userResult.user.id,
    locale,
  })

  if (!result.ok) {
    if (result.reason === "entry_not_found") {
      // Mirrors matchup AI route: non-owner is silently 404.
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }
    return NextResponse.json(
      { error: "Could not generate explanation. Please try again." },
      { status: 500 }
    )
  }

  // Increment cap only when the LLM was actually called (not deterministic fallback).
  if (result.generative) {
    await incrementWcAiCap("explain_bracket", userResult.user.id, tier)
  }

  let tokenSpend = null
  if (tokenAccess.mode === "tokens" && result.generative) {
    try {
      tokenSpend = await tokenAccess.commitTokenSpend()
    } catch {
      return NextResponse.json(
        {
          error: "Token spend failed after AI generation. No tokens were deducted.",
          code: "token_spend_failed_no_deduction",
          upgrade: true,
          upgradePath: "/tokens?ruleCode=world_cup_ai_bracket_explanation",
          preview: tokenAccess.tokenPreview,
        },
        { status: 402 }
      )
    }
  }

  return NextResponse.json({
    ok: true,
    summary: result.summary,
    lines: result.lines,
    generative: result.generative,
    tokenPreview: tokenAccess.mode === "tokens" ? tokenAccess.tokenPreview : null,
    tokenSpend,
  })
}

/**
 * GET ?action=uniqueness
 *
 * Returns server-aggregated pool comparison data for the uniqueness card.
 * Counts only — never raw other-user picks. Ownership enforced via the
 * same findFirst(id+challengeId+userId) pattern as the matchup AI route.
 */
export async function GET(
  req: NextRequest,
  props: { params: Promise<{ challengeId: string; entryId: string }> }
) {
  const params = await props.params
  const userResult = await requireWorldCupApiUser()
  if (!userResult.ok) return userResult.response

  const { challengeId, entryId } = params
  if (!challengeId || !entryId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const action = new URL(req.url).searchParams.get("action") ?? "uniqueness"
  if (action !== "uniqueness") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  // Ownership check — non-owner gets silent 404.
  const ownEntry = await (prisma as any).worldCupBracketEntry.findFirst({
    where: { id: entryId, challengeId, userId: userResult.user.id },
    select: {
      id: true,
      championTeamName: true,
      picks: {
        where: { selectedTeamName: { not: "" } },
        select: { round: true, selectedTeamName: true },
      },
    },
  })
  if (!ownEntry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 })
  }

  const hasBracketBrainAi = await userHasBracketBrainAi(
    userResult.user.id,
    userResult.user.email ?? null
  )

  // Finalized-only pool data. Never expose raw other-user picks — only counts.
  const finalizedEntries = await (prisma as any).worldCupBracketEntry.findMany({
    where: {
      challengeId,
      isComplete: true,
      submittedAt: { not: null },
    },
    select: {
      id: true,
      championTeamName: true,
      picks: {
        where: { selectedTeamName: { not: "" } },
        select: { round: true, selectedTeamName: true },
      },
    },
  })

  const finalizedEntryCount = Array.isArray(finalizedEntries)
    ? finalizedEntries.length
    : 0

  // Champion distribution.
  const championCounts = new Map<string, number>()
  for (const e of finalizedEntries) {
    const name = (e as { championTeamName: string | null }).championTeamName
    if (!name) continue
    championCounts.set(name, (championCounts.get(name) ?? 0) + 1)
  }

  // Per-round pick distribution. Dedupe within each (entry, round).
  const distByRound = new Map<string, Map<string, number>>()
  for (const e of finalizedEntries) {
    const seenPerRound = new Map<string, Set<string>>()
    const picks = ((e as { picks?: Array<{ round?: string; selectedTeamName?: string }> })
      .picks ?? [])
    for (const pick of picks) {
      const round = pick.round
      const team = pick.selectedTeamName
      if (!round || !team) continue
      if (!seenPerRound.has(round)) seenPerRound.set(round, new Set())
      const seen = seenPerRound.get(round)!
      if (seen.has(team)) continue
      seen.add(team)
      if (!distByRound.has(round)) distByRound.set(round, new Map())
      const inner = distByRound.get(round)!
      inner.set(team, (inner.get(team) ?? 0) + 1)
    }
  }

  const distributions: Record<string, Array<{ teamName: string; count: number }>> = {
    champion: Array.from(championCounts.entries()).map(([teamName, count]) => ({
      teamName,
      count,
    })),
  }
  for (const [round, inner] of distByRound) {
    distributions[round] = Array.from(inner.entries()).map(([teamName, count]) => ({
      teamName,
      count,
    }))
  }

  // Own picks aggregated by round (dedupe per round).
  const ownPicksByRound: Record<string, string[]> = {}
  for (const pick of ownEntry.picks ?? []) {
    const round = pick.round as string
    const team = pick.selectedTeamName as string
    if (!round || !team) continue
    if (!ownPicksByRound[round]) ownPicksByRound[round] = []
    if (!ownPicksByRound[round].includes(team)) ownPicksByRound[round].push(team)
  }

  return NextResponse.json({
    ok: true,
    finalizedEntryCount,
    distributions,
    ownChampionTeamName: ownEntry.championTeamName ?? null,
    ownPicksByRound,
    hasBracketBrainAi,
  })
}
