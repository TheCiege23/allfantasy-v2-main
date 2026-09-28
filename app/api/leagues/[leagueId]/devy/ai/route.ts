/**
 * PROMPT 5: Devy AI — scout, promotion advisor, draft assistant, class storytelling, trade context.
 * AI never decides outcomes; only explains, recommends, narrates.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isDevyLeague } from '@/lib/devy'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import {
  buildDevyScoutContext,
  buildDevyPromotionAdvisorContext,
  buildDevyDraftAssistantContext,
  buildDevyClassStorytellingContext,
  buildDevyTradeContextFromPayload,
  buildDevyRookieVsDevyContext,
} from '@/lib/devy/ai/DevyAIContext'
import { buildDevyAIPrompt } from '@/lib/devy/ai/DevyAIPrompts'
import { openaiChatText } from '@/lib/openai-client'
import { withOfficialTimeUserMessage } from '@/lib/time-engine/chimmyPromptPrefix'

export const dynamic = 'force-dynamic'

export type DevyAIType = 'scout' | 'promotion_advisor' | 'draft_assistant' | 'class_storytelling' | 'trade_context' | 'rookie_vs_devy_decision'

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

  const isDevy = await isDevyLeague(leagueId)
  if (!isDevy) return NextResponse.json({ error: 'Not a devy league' }, { status: 404 })

  // OpenAI per call. The sibling /api/devy/ai requires commissioner_ai_tools; this matched nothing.
  const gated = await aiCostGate(req, 'league_format_ai', userId)
  if (gated) return gated

  const body = await req.json().catch(() => ({}))
  const type = (body.type as DevyAIType) ?? 'scout'

  let context: Awaited<ReturnType<typeof buildDevyScoutContext>> |
    Awaited<ReturnType<typeof buildDevyPromotionAdvisorContext>> |
    Awaited<ReturnType<typeof buildDevyDraftAssistantContext>> |
    Awaited<ReturnType<typeof buildDevyClassStorytellingContext>> |
    Awaited<ReturnType<typeof buildDevyTradeContextFromPayload>> |
    Awaited<ReturnType<typeof buildDevyRookieVsDevyContext>> | null = null

  if (type === 'scout' && body.devyPlayerId) {
    context = await buildDevyScoutContext({ leagueId, devyPlayerId: body.devyPlayerId, userId })
  } else if (type === 'promotion_advisor' && body.rosterId) {
    context = await buildDevyPromotionAdvisorContext({ leagueId, rosterId: body.rosterId, userId })
  } else if (type === 'draft_assistant' && body.rosterId && body.phase) {
    context = await buildDevyDraftAssistantContext({
      leagueId,
      rosterId: body.rosterId,
      phase: body.phase,
      round: body.round ?? 1,
      pick: body.pick ?? 1,
      userId,
    })
  } else if (type === 'class_storytelling') {
    context = await buildDevyClassStorytellingContext({ leagueId, userId })
  } else if (type === 'trade_context' && body.side && Array.isArray(body.assets)) {
    context = await buildDevyTradeContextFromPayload({
      leagueId,
      side: body.side,
      assets: body.assets,
      partnerRosterId: body.partnerRosterId,
      userId,
    })
  } else if (type === 'rookie_vs_devy_decision' && body.rosterId) {
    context = await buildDevyRookieVsDevyContext({ leagueId, rosterId: body.rosterId, userId })
  }

  if (!context) {
    return NextResponse.json({ error: 'Could not build context for this request' }, { status: 400 })
  }

  const { system, user } = buildDevyAIPrompt(context as any)
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
      { error: (res as any).details ?? 'AI request failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    type,
    narrative: res.text,
    model: (res as any).model,
  })
}
