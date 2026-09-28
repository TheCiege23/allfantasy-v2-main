/**
 * IDP AI — draft, waiver, trade, start/sit, league educator.
 * AI never decides outcomes; only explains, recommends, narrates.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isIdpLeague } from '@/lib/idp'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import {
  buildIdpDraftAssistantContext,
  buildIdpWaiverAssistantContext,
  buildIdpTradeAnalyzerContext,
  buildIdpStartSitContext,
  buildIdpLeagueEducatorContext,
} from '@/lib/idp/ai/IdpAIContext'
import { buildIdpAIPrompt } from '@/lib/idp/ai/IdpAIPrompts'
import { openaiChatText } from '@/lib/openai-client'
import { withOfficialTimeUserMessage } from '@/lib/time-engine/chimmyPromptPrefix'

export const dynamic = 'force-dynamic'

export type IdpAIType =
  | 'draft_assistant'
  | 'waiver_assistant'
  | 'trade_analyzer'
  | 'start_sit'
  | 'league_educator'

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

  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  // OpenAI per call. The sibling /api/idp/ai requires commissioner_ai_tools; this matched nothing.
  const gated = await aiCostGate(req, 'league_format_ai', userId)
  if (gated) return gated

  const body = await req.json().catch(() => ({}))
  const type = (body.type as IdpAIType) ?? 'league_educator'

  let context: Awaited<ReturnType<typeof buildIdpDraftAssistantContext>> |
    Awaited<ReturnType<typeof buildIdpWaiverAssistantContext>> |
    Awaited<ReturnType<typeof buildIdpTradeAnalyzerContext>> |
    Awaited<ReturnType<typeof buildIdpStartSitContext>> |
    Awaited<ReturnType<typeof buildIdpLeagueEducatorContext>> | null = null

  if (type === 'draft_assistant') {
    context = await buildIdpDraftAssistantContext(
      leagueId,
      body.rosterId,
      body.currentRound
    )
  } else if (type === 'waiver_assistant') {
    context = await buildIdpWaiverAssistantContext(leagueId, {
      rosterId: body.rosterId,
      availableDefenders: body.availableDefenders,
      myIdpRoster: body.myIdpRoster,
    })
  } else if (type === 'trade_analyzer') {
    context = await buildIdpTradeAnalyzerContext(leagueId, {
      side: body.side ?? 'sender',
      assets: body.assets ?? [],
      partnerAssets: body.partnerAssets,
      idpLineupWarning: body.idpLineupWarning,
    })
  } else if (type === 'start_sit') {
    context = await buildIdpStartSitContext(leagueId, {
      slot: body.slot ?? 'IDP_FLEX',
      options: body.options ?? [],
    })
  } else if (type === 'league_educator') {
    context = await buildIdpLeagueEducatorContext(leagueId)
  }

  if (!context) {
    return NextResponse.json({ error: 'Could not build context for this request' }, { status: 400 })
  }

  const { system, user } = buildIdpAIPrompt(type, context as any)
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
