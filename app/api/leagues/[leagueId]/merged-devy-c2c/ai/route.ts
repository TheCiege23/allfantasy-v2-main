/**
 * C2C AI: Pipeline Advisor, College vs Rookie Decision, Startup Draft Assistant,
 * Promotion Advisor, Hybrid Strategy, Trade Context. PROMPT 5.
 * AI never decides outcomes; only explains, recommends, compares, narrates.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isC2CLeague } from '@/lib/merged-devy-c2c/C2CLeagueConfig'
import {
  buildC2CPipelineAdvisorContext,
  buildC2CCollegeVsRookieContext,
  buildC2CStartupDraftAssistantContext,
  buildC2CPromotionAdvisorContext,
  buildC2CHybridStrategyContext,
  buildC2CTradeContextFromPayload,
} from '@/lib/merged-devy-c2c/ai/C2CAIContext'
import { buildC2CAIPrompt } from '@/lib/merged-devy-c2c/ai/C2CAIPrompts'
import { openaiChatText } from '@/lib/openai-client'
import { requireMemberPlayerAi } from '@/lib/subscription/memberPlayerAiGate'
import { withOfficialTimeUserMessage } from '@/lib/time-engine/chimmyPromptPrefix'

export const dynamic = 'force-dynamic'

export type C2CAIType =
  | 'pipeline_advisor'
  | 'college_vs_rookie_decision'
  | 'startup_draft_assistant'
  | 'promotion_advisor'
  | 'hybrid_strategy'
  | 'trade_context'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isC2C = await isC2CLeague(leagueId)
  if (!isC2C) return NextResponse.json({ error: 'Not a C2C league' }, { status: 404 })

  // OpenAI per call. Every type is player-level advice to a manager about their own roster, so it is Chimmy
  // Intelligence (`af_intelligence`: AF Pro, AF Commissioner, AF Supreme) plus the member daily cap, the same
  // gate and the same place as its devy sibling (owner, 2026-11-28): before any context read or model call.
  const gated = await requireMemberPlayerAi(req)
  if (typeof gated !== 'string') return gated

  const body = await req.json().catch(() => ({}))
  const type = (body.type as C2CAIType) ?? 'pipeline_advisor'

  let context: Awaited<ReturnType<typeof buildC2CPipelineAdvisorContext>> |
    Awaited<ReturnType<typeof buildC2CCollegeVsRookieContext>> |
    Awaited<ReturnType<typeof buildC2CStartupDraftAssistantContext>> |
    Awaited<ReturnType<typeof buildC2CPromotionAdvisorContext>> |
    Awaited<ReturnType<typeof buildC2CHybridStrategyContext>> |
    Awaited<ReturnType<typeof buildC2CTradeContextFromPayload>> | null = null

  if (type === 'pipeline_advisor' && body.rosterId) {
    context = await buildC2CPipelineAdvisorContext({ leagueId, rosterId: body.rosterId, userId })
  } else if (type === 'college_vs_rookie_decision' && body.rosterId) {
    context = await buildC2CCollegeVsRookieContext({ leagueId, rosterId: body.rosterId, userId })
  } else if (type === 'startup_draft_assistant' && body.rosterId && body.phase) {
    context = await buildC2CStartupDraftAssistantContext({
      leagueId,
      rosterId: body.rosterId,
      phase: body.phase,
      round: body.round ?? 1,
      pick: body.pick ?? 1,
      direction: body.direction,
      userId,
    })
  } else if (type === 'promotion_advisor' && body.rosterId) {
    context = await buildC2CPromotionAdvisorContext({ leagueId, rosterId: body.rosterId, userId })
  } else if (type === 'hybrid_strategy' && body.rosterId) {
    context = await buildC2CHybridStrategyContext({ leagueId, rosterId: body.rosterId, userId })
  } else if (type === 'trade_context' && body.side && Array.isArray(body.assets)) {
    context = await buildC2CTradeContextFromPayload({
      leagueId,
      side: body.side,
      assets: body.assets,
      partnerRosterId: body.partnerRosterId,
      userId,
    })
  }

  if (!context) {
    return NextResponse.json(
      { error: 'Could not build context for this request. Check type and required body fields (e.g. rosterId, phase, side, assets).' },
      { status: 400 }
    )
  }

  const { system, user } = buildC2CAIPrompt(context as any)
  const userWithTime = await withOfficialTimeUserMessage(userId, user)
  const res = await openaiChatText({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userWithTime },
    ],
    temperature: 0.5,
    maxTokens: 600,
  })

  if (!res.ok) {
    return NextResponse.json(
      { error: (res as any).details ?? 'Chimmy request failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    type,
    narrative: res.text,
    model: (res as any).model,
  })
}
