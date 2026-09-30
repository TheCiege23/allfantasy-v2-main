import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import { prisma } from "@/lib/prisma"
import { userHasWorldCupCommissionerAccess } from "@/lib/world-cup/worldCupCommissionerAccess"
import {
  prepareWorldCupAiTokenFallback,
  WORLD_CUP_AI_TOKEN_RULES,
} from "@/lib/world-cup/worldCupAiTokenFallback"
import {
  buildWorldCupAiPoolRecapLines,
  generateAiWrappedLines,
  generateInsightCard,
  getWorldCupCommissionerBrainSnapshot,
  type WorldCupAiRecapTone,
  type InsightCard,
} from "@/lib/world-cup/worldCupCommissionerBrainService"
import { WORLD_CUP_BRACKET_EVENT_TYPES } from "@/lib/world-cup/worldCupBracketEvents"
import {
  emitWorldCupBracketChatEvent,
  getWorldCupCommissionerSettings,
} from "@/lib/world-cup/worldCupBracketEventService"
import { isWorldCupBracketBrainEnabledForChallenge } from "@/lib/world-cup/worldCupBracketSettingsService"
import {
  assertWorldCupManager,
  requireWorldCupApiUser,
  worldCupChallengeParamsSchema,
} from "../../_utils"

export const runtime = "nodejs"

const CARD_ACTIONS = ["pool_swing_card", "rooting_guide_card", "champion_risk_card", "commissioner_recap_card"] as const
type CardAction = typeof CARD_ACTIONS[number]
const CARD_ACTION_TO_KIND: Record<CardAction, Parameters<typeof generateInsightCard>[0]> = {
  pool_swing_card: "pool_swing",
  rooting_guide_card: "rooting_guide",
  champion_risk_card: "champion_risk",
  commissioner_recap_card: "commissioner_recap",
}

const postSchema = z.object({
  action: z.enum([
    // existing text-line generators
    "hype",
    "standings",
    "watch",
    "recap",
    "preview_recap",
    "post_recap",
    "drama_recap",
    "path",
    "reminder",
    // proactive text generators
    "chalk_bust",
    "match_swing",
    "trash_talk",
    "at_risk",
    "social_invite",
    "quiet_pool",
    "tomorrow_hype",
    // structured insight card generators (return { card }, do not auto-post)
    "pool_swing_card",
    "rooting_guide_card",
    "champion_risk_card",
    "commissioner_recap_card",
  ]),
  round: z.string().optional(),
  entryId: z.string().optional(),
  tone: z.enum(["fun", "serious", "hype"]).optional().default("fun"),
  lines: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  confirmTokenSpend: z.boolean().optional().default(false),
})

export async function GET(
  request: Request,
  context: { params: Promise<{ challengeId: string }> }
) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(
    request,
    params.data.challengeId,
    auth.user
  )
  if (!access.ok) return access.response

  const [snapshot, settings, hasAi, hasAfCommissioner, challengeRow] = await Promise.all([
    getWorldCupCommissionerBrainSnapshot(params.data.challengeId),
    getWorldCupCommissionerSettings(params.data.challengeId),
    userHasBracketBrainAi(auth.user.id, auth.user.email ?? null),
    userHasWorldCupCommissionerAccess(auth.user.id, auth.user.email ?? null),
    prisma.worldCupBracketChallenge.findUnique({
      where: { id: params.data.challengeId },
      select: { sourcePayload: true },
    }),
  ])

  return NextResponse.json({
    snapshot,
    settings,
    hasBracketBrainAi: Boolean(access.isAdmin || hasAfCommissioner),
    hasAfPro: hasAi,
    hasAfCommissioner: Boolean(access.isAdmin || hasAfCommissioner),
    bracketBrainEnabled: isWorldCupBracketBrainEnabledForChallenge(challengeRow?.sourcePayload),
  })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ challengeId: string }> }
) {
  const auth = await requireWorldCupApiUser()
  if (!auth.ok) return auth.response

  const params = worldCupChallengeParamsSchema.safeParse((await context.params))
  if (!params.success) {
    return NextResponse.json({ error: "Invalid challenge id" }, { status: 400 })
  }

  const access = await assertWorldCupManager(
    request,
    params.data.challengeId,
    auth.user
  )
  if (!access.ok) return access.response

  const body = await request.json().catch(() => ({}))
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const [hasAi, hasAfCommissioner] = await Promise.all([
    userHasBracketBrainAi(auth.user.id, auth.user.email ?? null),
    userHasWorldCupCommissionerAccess(auth.user.id, auth.user.email ?? null),
  ])
  const hasCommissionerAiAccess = Boolean(access.isAdmin || hasAfCommissioner)
  const tokenAccess = await prepareWorldCupAiTokenFallback({
    userId: auth.user.id,
    userEmail: auth.user.email ?? null,
    entitled: hasCommissionerAiAccess,
    ruleCode: WORLD_CUP_AI_TOKEN_RULES.commissionerReport,
    confirmTokenSpend: parsed.data.confirmTokenSpend,
    sourceType: "world_cup_commissioner_brain",
    sourceId: `${params.data.challengeId}:${parsed.data.action}`,
    idempotencyKey: `wc-commissioner-brain:${auth.user.id}:${params.data.challengeId}:${parsed.data.action}:${parsed.data.round ?? "none"}:${parsed.data.tone}`,
    description: "World Cup commissioner AI report",
    metadata: {
      challengeId: params.data.challengeId,
      action: parsed.data.action,
      round: parsed.data.round ?? null,
      hasAfPro: hasAi,
    },
    upgradePath: "/commissioner-upgrade?feature=commissioner_ai_tools",
  })
  if (!tokenAccess.ok) return tokenAccess.response

  const challengeRow = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: params.data.challengeId },
    select: { sourcePayload: true },
  })
  if (!isWorldCupBracketBrainEnabledForChallenge(challengeRow?.sourcePayload)) {
    return NextResponse.json(
      {
        error: "Bracket Brain is disabled in league settings.",
        bracketBrainDisabled: true,
      },
      { status: 403 }
    )
  }

  // ── Structured card actions — return { card }, never auto-post ──────────────
  const isCardAction = (CARD_ACTIONS as readonly string[]).includes(parsed.data.action)
  if (isCardAction) {
    const cardKind = CARD_ACTION_TO_KIND[parsed.data.action as CardAction]
    const card: InsightCard | null = await generateInsightCard(cardKind, params.data.challengeId, {
      entryId: parsed.data.entryId,
    })
    if (!card) {
      return NextResponse.json(
        { error: "Not enough pool data to generate this insight card yet." },
        { status: 422 },
      )
    }
    return NextResponse.json({ ok: true, card, posted: false })
  }

  const isRecapPreview = parsed.data.action === "preview_recap"
  const isRecapPost = parsed.data.action === "post_recap"
  const isDramaRecap = parsed.data.action === "drama_recap"

  type WrappedAction = Parameters<typeof generateAiWrappedLines>[0]
  const wrappedAction = parsed.data.action as WrappedAction

  const lines = isRecapPost && parsed.data.lines?.length
    ? parsed.data.lines
    : isRecapPreview || isRecapPost || isDramaRecap
      ? await buildWorldCupAiPoolRecapLines(params.data.challengeId, parsed.data.tone as WorldCupAiRecapTone)
      : await generateAiWrappedLines(wrappedAction, params.data.challengeId, {
          round: parsed.data.round as any,
          entryId: parsed.data.entryId,
        })

  let tokenSpend = null
  if (isRecapPreview && tokenAccess.mode === "tokens") {
    try {
      tokenSpend = await tokenAccess.commitTokenSpend()
    } catch {
      return NextResponse.json(
        {
          error: "Token spend failed after Commissioner Brain generation. No tokens were deducted.",
          code: "token_spend_failed_no_deduction",
          upgrade: true,
          upgradePath: "/tokens?ruleCode=world_cup_ai_commissioner_report",
          preview: tokenAccess.tokenPreview,
        },
        { status: 402 }
      )
    }
  }

  if (isRecapPreview) {
    return NextResponse.json({
      lines,
      action: parsed.data.action,
      posted: false,
      source: "deterministic_finalized_public",
      tokenPreview: tokenAccess.mode === "tokens" ? tokenAccess.tokenPreview : null,
      tokenSpend,
    })
  }

  const titleByAction: Record<string, string> = {
    hype: "Bracket hype",
    standings: "Standings snapshot",
    watch: "What to watch",
    recap: "Round recap",
    preview_recap: "AI pool recap preview",
    post_recap: "AI pool recap",
    drama_recap: "Pool Drama Report",
    path: "Path to win",
    reminder: "Reminder",
    chalk_bust: "Chalk Bust Alert",
    match_swing: "Match Swing Report",
    trash_talk: "Pool Trash Talk",
    at_risk: "At-Risk Report",
    social_invite: "Social Invite",
    quiet_pool: "Engagement Nudge",
    tomorrow_hype: "Tomorrow's Hype",
  }

  const bodyText = lines.join("\n").slice(0, 4000)
  await emitWorldCupBracketChatEvent({
    challengeId: params.data.challengeId,
    eventType: WORLD_CUP_BRACKET_EVENT_TYPES.COMMISSIONER_BRAIN_MESSAGE,
    eventTitle: titleByAction[parsed.data.action] ?? "Commissioner update",
    eventBody: bodyText,
    idempotencyKey: randomUUID(),
    userId: auth.user.id,
    isAiGenerated: true,
    metadata: {
      action: parsed.data.action,
      visibility: "public",
      messageType: isRecapPost ? "ai_recap" : "commissioner_brain",
      source: isRecapPost || isDramaRecap ? "deterministic_finalized_public" : undefined,
    },
    force: true,
  })

  if (tokenAccess.mode === "tokens") {
    try {
      tokenSpend = await tokenAccess.commitTokenSpend()
    } catch {
      return NextResponse.json(
        {
          error: "Token spend failed after Commissioner Brain generation. No tokens were deducted.",
          code: "token_spend_failed_no_deduction",
          upgrade: true,
          upgradePath: "/tokens?ruleCode=world_cup_ai_commissioner_report",
          preview: tokenAccess.tokenPreview,
        },
        { status: 402 }
      )
    }
  }

  return NextResponse.json({
    ok: true,
    lines,
    action: parsed.data.action,
    posted: true,
    source: isDramaRecap ? "deterministic" : undefined,
    tokenPreview: tokenAccess.mode === "tokens" ? tokenAccess.tokenPreview : null,
    tokenSpend,
  })
}
