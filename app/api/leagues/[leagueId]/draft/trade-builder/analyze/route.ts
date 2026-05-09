/**
 * POST: Evaluate a hypothetical trade (no saved proposal) using the same rules as create + DraftTradeAiReview.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { getDraftSessionByLeague } from '@/lib/live-draft-engine/DraftSessionService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { buildDraftTradeAiReview } from '@/lib/live-draft-engine/DraftTradeAiReviewService'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { isDraftPickTradingAllowedForLeague } from '@/lib/tournament-mode/safety'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { getProviderStatus } from '@/lib/provider-config'
import { buildDraftExecutionMetadata, evaluateAIInvocationPolicy, withTimeout } from '@/lib/draft-automation-policy'
import { resolveOverallForRoundSlot } from '@/lib/live-draft-engine/draftPickTradeInventory'
import { buildDraftPickTradeStructuredAnalysis } from '@/lib/live-draft-engine/draftPickTradeStructuredAnalysis'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { getCanonicalDraftState } from '@/lib/draft/getCanonicalDraftState'
import type { TradedPickRecord } from '@/lib/live-draft-engine/types'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  if (!myRosterId) return NextResponse.json({ error: 'You do not have a roster in this league' }, { status: 403 })

  const draftPickTradingAllowed = await isDraftPickTradingAllowedForLeague(leagueId)
  if (!draftPickTradingAllowed) {
    return NextResponse.json({ error: 'Draft pick trading is disabled for this league mode.' }, { status: 403 })
  }
  const uiSettings = await getDraftUISettingsForLeague(leagueId)
  if (!uiSettings.pickTradeEnabled) {
    return NextResponse.json({ error: 'Draft pick trading is disabled in draft settings.' }, { status: 403 })
  }

  const draftSession = await getDraftSessionByLeague(leagueId)
  if (!draftSession || draftSession.status !== 'in_progress') {
    return NextResponse.json({ error: 'No draft in progress' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const giveRound = Math.max(1, Number(body.giveRound) || 1)
  const giveSlot = Math.max(1, Number(body.giveSlot) || 1)
  const receiveRound = Math.max(1, Number(body.receiveRound) || 1)
  const receiveSlot = Math.max(1, Number(body.receiveSlot) || 1)
  const receiverRosterId = String(body.receiverRosterId ?? body.receiver_roster_id ?? '').trim()
  const includeAiExplanation = Boolean(body.includeAiExplanation ?? body.include_ai_explanation ?? false)

  if (!receiverRosterId) return NextResponse.json({ error: 'receiverRosterId required' }, { status: 400 })
  if (receiverRosterId === myRosterId) {
    return NextResponse.json({ error: 'Cannot analyze a trade with your own roster.' }, { status: 400 })
  }
  if (giveRound > draftSession.rounds || receiveRound > draftSession.rounds) {
    return NextResponse.json({ error: 'Round out of range for this draft.' }, { status: 400 })
  }

  const slotOrder = (draftSession.slotOrder as { slot: number; rosterId: string; displayName: string }[]) ?? []
  const rawTradedPicks = (draftSession as { tradedPicks?: unknown }).tradedPicks
  const tradedPicks = (Array.isArray(rawTradedPicks) ? rawTradedPicks : []) as unknown as TradedPickRecord[]

  const giveResolvedOwner = resolvePickOwner(giveRound, giveSlot, slotOrder, tradedPicks)
  const receiveResolvedOwner = resolvePickOwner(receiveRound, receiveSlot, slotOrder, tradedPicks)
  if (!giveResolvedOwner || giveResolvedOwner.rosterId !== myRosterId) {
    return NextResponse.json(
      {
        ok: false,
        code: 'INVALID_GIVE',
        error: `You must offer a pick your roster currently owns.`,
      },
      { status: 400 }
    )
  }
  if (!receiveResolvedOwner || receiveResolvedOwner.rosterId !== receiverRosterId) {
    return NextResponse.json(
      {
        ok: false,
        code: 'INVALID_RECEIVE',
        error: `Their pick must be one this manager currently owns.`,
      },
      { status: 400 }
    )
  }

  const draftedOveralls = new Set((draftSession.picks ?? []).map((pick) => pick.overall))
  const giveOverall = resolveOverallForRoundSlot({
    round: giveRound,
    slot: giveSlot,
    teamCount: draftSession.teamCount,
    draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: draftSession.thirdRoundReversal,
  })
  const receiveOverall = resolveOverallForRoundSlot({
    round: receiveRound,
    slot: receiveSlot,
    teamCount: draftSession.teamCount,
    draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: draftSession.thirdRoundReversal,
  })
  if ((giveOverall != null && draftedOveralls.has(giveOverall)) || (receiveOverall != null && draftedOveralls.has(receiveOverall))) {
    return NextResponse.json({ ok: false, code: 'PICK_ALREADY_USED', error: 'Cannot trade picks already made.' }, { status: 400 })
  }

  const structuredAnalysis = buildDraftPickTradeStructuredAnalysis({
    giveOverall,
    receiveOverall,
    teamCount: draftSession.teamCount,
  })

  const review = buildDraftTradeAiReview({
    giveRound,
    giveSlot,
    receiveRound,
    receiveSlot,
    teamCount: draftSession.teamCount,
    draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: draftSession.thirdRoundReversal,
  })

  const premiumTradeAi = (await new EntitlementResolver().resolveForUser(userId, 'pro_trade_ai')).hasAccess

  const invocation = evaluateAIInvocationPolicy({
    feature: 'private_trade_review',
    scopeId: leagueId,
    requestAI: includeAiExplanation && premiumTradeAi,
    aiEnabled: true,
    providerAvailable: getProviderStatus().anyAi,
  })

  let summary = review.summary
  let aiUsed = false
  let reasonCode = invocation.reasonCode
  if (!premiumTradeAi && includeAiExplanation) {
    reasonCode = 'entitlement_deterministic_only'
  }
  let aiConfidence: number | null = null

  const mySlotEntry = slotOrder.find((s) => s.rosterId === myRosterId)
  const partnerSlotEntry = slotOrder.find((s) => s.rosterId === receiverRosterId)
  const canonicalDraftState = await getCanonicalDraftState({
    leagueId,
    draftId: draftSession.id,
  })
  const picksMade = canonicalDraftState?.picksMade ?? (draftSession.picks ?? []).length
  const currentPick = canonicalDraftState?.nextPick?.overall != null
    ? {
        overall: canonicalDraftState.nextPick.overall,
        round: canonicalDraftState.nextPick.round ?? 1,
        slot: canonicalDraftState.nextPick.slot ?? 1,
        rosterId: canonicalDraftState.currentTeamId ?? undefined,
      }
    : null

  if (invocation.decision === 'allow_ai') {
    const aiResult = await withTimeout(
      openaiChatJson({
        skipCache: true,
        temperature: 0.35,
        maxTokens: 420,
        messages: [
          {
            role: 'system',
            content:
              'You analyze live fantasy draft pick trades (snake/redraft). Use only the JSON facts provided. Return strict JSON: { "summary": string (2 short sentences), "confidence": number between 0 and 1 } reflecting how certain your wording is given public draft-capital logic — not player predictions.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              leagueId,
              draftContext: {
                draftType: draftSession.draftType,
                thirdRoundReversal: draftSession.thirdRoundReversal,
                teamCount: draftSession.teamCount,
                rounds: draftSession.rounds,
                picksMade,
                approximateNextOverall: picksMade + 1,
                currentPick: currentPick
                  ? {
                      overall: currentPick.overall,
                      round: currentPick.round,
                      slot: currentPick.slot,
                      onClockRosterId: currentPick.rosterId ?? null,
                    }
                  : null,
              },
              trade: {
                youGive: {
                  round: giveRound,
                  slot: giveSlot,
                  overall: giveOverall,
                  ownerLabel: mySlotEntry?.displayName ?? 'You',
                },
                youReceive: {
                  round: receiveRound,
                  slot: receiveSlot,
                  overall: receiveOverall,
                  ownerLabel: partnerSlotEntry?.displayName ?? 'Partner',
                },
                structured: structuredAnalysis,
                deterministicVerdict: review.verdict,
                deterministicReasons: review.reasons,
              },
            }),
          },
        ],
      }),
      invocation.maxLatencyMs
    )

    if (!aiResult.ok) {
      reasonCode = 'ai_timeout_deterministic_fallback'
    } else if (!aiResult.value.ok) {
      reasonCode = 'ai_error_deterministic_fallback'
    } else {
      const parsed = parseJsonContentFromChatCompletion(aiResult.value.json) as {
        summary?: unknown
        confidence?: unknown
      } | null
      const text = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
      if (text.length > 0) {
        summary = text
        aiUsed = true
        reasonCode = 'ai_trade_preview'
        const c = parsed?.confidence
        if (typeof c === 'number' && Number.isFinite(c)) {
          aiConfidence = Math.max(0, Math.min(1, c))
        }
      } else {
        reasonCode = 'ai_parse_fallback'
      }
    }
  }

  return NextResponse.json({
    ok: true,
    verdict: review.verdict,
    reasons: review.reasons,
    declineReasons: review.declineReasons,
    counterReasons: review.counterReasons,
    summary,
    suggestedCounterPackage: review.suggestedCounterPackage,
    structuredAnalysis,
    aiConfidence,
    execution: buildDraftExecutionMetadata({
      feature: 'private_trade_review',
      aiUsed,
      aiEligible: invocation.canShowAIButton,
      reasonCode,
      fallbackToDeterministic: includeAiExplanation && !aiUsed && invocation.decision !== 'deny_dead_button',
    }),
  })
}
