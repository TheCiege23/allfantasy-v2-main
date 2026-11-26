/**
 * POST: Private review of an incoming pick-swap offer for the receiving manager.
 * The verdict (accept | counter | reject | even | not_graded), reasons and values are THE league grade's
 * (`draftPickTradeCanonicalReview`); the draft-position move is a fact; AF Pro adds an AI summary that
 * explains the grade and never overrides it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import { draftPickTradeGraderSource, reviewDraftPickSwap } from '@/lib/live-draft-engine/draftPickTradeCanonicalReview'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { getProviderStatus } from '@/lib/provider-config'
import { sendPrivateTradeAIDM } from '@/lib/trade-ai-dm/TradeAIDMService'
import {
  buildDraftExecutionMetadata,
  evaluateAIInvocationPolicy,
  withTimeout,
} from '@/lib/draft-automation-policy'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { getDraftSessionByLeague } from '@/lib/live-draft-engine/DraftSessionService'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { resolveOverallForRoundSlot } from '@/lib/live-draft-engine/draftPickTradeInventory'
import { buildDraftPickTradeStructuredAnalysis } from '@/lib/live-draft-engine/draftPickTradeStructuredAnalysis'
import type { TradedPickRecord } from '@/lib/live-draft-engine/types'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; proposalId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, proposalId } = await ctx.params
  if (!leagueId || !proposalId) return NextResponse.json({ error: 'Missing leagueId or proposalId' }, { status: 400 })
  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const myRosterId = await getCurrentUserRosterIdForLeague(leagueId, userId)
  const proposal = await (prisma as any).draftPickTradeProposal.findFirst({
    where: { id: proposalId },
    include: { session: { select: { leagueId: true, teamCount: true, id: true } } },
  })
  if (!proposal || proposal.session?.leagueId !== leagueId) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }
  if (proposal.receiverRosterId !== myRosterId) {
    return NextResponse.json({ error: 'Only the receiver can request AI review' }, { status: 403 })
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: 'Proposal already responded to' }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  const includeAiExplanation = Boolean(
    body?.includeAiExplanation ?? body?.include_ai_explanation ?? false
  )

  const draftSession = await getDraftSessionByLeague(leagueId)
  if (!draftSession || draftSession.status !== 'in_progress') {
    return NextResponse.json({ error: 'Draft is not live — this offer may be stale.' }, { status: 400 })
  }

  const rawSlotOrder = (draftSession as { slotOrder?: unknown }).slotOrder
  const slotOrder = (Array.isArray(rawSlotOrder) ? rawSlotOrder : []) as unknown as {
    slot: number
    rosterId: string
    displayName: string
  }[]
  const rawTradedPicks = (draftSession as { tradedPicks?: unknown }).tradedPicks
  const tradedPicks = (Array.isArray(rawTradedPicks) ? rawTradedPicks : []) as unknown as TradedPickRecord[]

  const proposerRosterId = String(proposal.proposerRosterId)
  const receiverRosterId = String(proposal.receiverRosterId)

  const giveOwner = resolvePickOwner(proposal.giveRound, proposal.giveSlot, slotOrder, tradedPicks)
  const recvOwner = resolvePickOwner(proposal.receiveRound, proposal.receiveSlot, slotOrder, tradedPicks)
  if (!giveOwner || giveOwner.rosterId !== proposerRosterId) {
    return NextResponse.json(
      {
        ok: false,
        code: 'STALE_PROPOSAL_GIVE',
        error: 'Their offered pick is no longer owned as stored — refresh offers.',
      },
      { status: 409 }
    )
  }
  if (!recvOwner || recvOwner.rosterId !== receiverRosterId) {
    return NextResponse.json(
      {
        ok: false,
        code: 'STALE_PROPOSAL_RECEIVE',
        error: 'Your pick in this offer is no longer yours — refresh offers.',
      },
      { status: 409 }
    )
  }

  const draftedOveralls = new Set((draftSession.picks ?? []).map((pick: { overall: number }) => pick.overall))
  const giveOverallPick = resolveOverallForRoundSlot({
    round: proposal.giveRound,
    slot: proposal.giveSlot,
    teamCount: draftSession.teamCount,
    draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: draftSession.thirdRoundReversal,
  })
  const receiveOverallPick = resolveOverallForRoundSlot({
    round: proposal.receiveRound,
    slot: proposal.receiveSlot,
    teamCount: draftSession.teamCount,
    draftType: draftSession.draftType as 'snake' | 'linear' | 'auction',
    thirdRoundReversal: draftSession.thirdRoundReversal,
  })
  if (
    (giveOverallPick != null && draftedOveralls.has(giveOverallPick)) ||
    (receiveOverallPick != null && draftedOveralls.has(receiveOverallPick))
  ) {
    return NextResponse.json(
      {
        ok: false,
        code: 'PICK_ALREADY_USED',
        error: 'One or both picks were already used — this offer is invalid.',
      },
      { status: 409 }
    )
  }

  const dt = draftSession.draftType as 'snake' | 'linear' | 'auction'
  const trr = Boolean(draftSession.thirdRoundReversal)

  /*
   * Receiver POV: you give receive*, you get give*. 🛑 THE ONE GRADE is the verdict (2026-11-26) — the
   * same one the builder and the offer DM read. Membership was verified by `canAccessLeagueDraft`, and the
   * viewer is this offer's receiver.
   */
  const { tradeGrade, review } = await reviewDraftPickSwap(
    draftPickTradeGraderSource({ leagueId, userId }),
    draftSession,
    {
      give: { round: proposal.receiveRound, slot: proposal.receiveSlot },
      get: { round: proposal.giveRound, slot: proposal.giveSlot },
    },
    slotOrder.find((s) => s.rosterId === proposerRosterId)?.displayName ?? proposal.proposerName ?? null,
  )

  const giveOverallYou = resolveOverallForRoundSlot({
    round: proposal.receiveRound,
    slot: proposal.receiveSlot,
    teamCount: draftSession.teamCount,
    draftType: dt,
    thirdRoundReversal: trr,
  })
  const receiveOverallYou = resolveOverallForRoundSlot({
    round: proposal.giveRound,
    slot: proposal.giveSlot,
    teamCount: draftSession.teamCount,
    draftType: dt,
    thirdRoundReversal: trr,
  })

  const structuredAnalysis = buildDraftPickTradeStructuredAnalysis({
    giveOverall: giveOverallYou,
    receiveOverall: receiveOverallYou,
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
  const partnerSlotEntry = slotOrder.find((s) => s.rosterId === proposerRosterId)
  const picksMade = (draftSession.picks ?? []).length
  const currentPick = (draftSession as { currentPick?: { overall: number; round: number; slot: number; rosterId?: string } | null })
    .currentPick

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
              'You analyze live fantasy draft pick trades (snake/redraft). Use only the JSON facts provided. If trade.leagueGrade is present it is THE AllFantasy grade for this offer and it is the verdict: explain it and never contradict it or call the trade better or worse than it says. If trade.gradeWithheld is present the offer is NOT graded: say why and never call it good, bad, fair or unfair. Return strict JSON: { "summary": string (2 short sentences), "confidence": number between 0 and 1 } reflecting how certain your wording is — not player predictions.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              leagueId,
              perspective: 'receiver_evaluating_incoming_offer',
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
                  round: proposal.receiveRound,
                  slot: proposal.receiveSlot,
                  overall: giveOverallYou,
                  ownerLabel: mySlotEntry?.displayName ?? 'You',
                },
                youReceive: {
                  round: proposal.giveRound,
                  slot: proposal.giveSlot,
                  overall: receiveOverallYou,
                  ownerLabel: partnerSlotEntry?.displayName ?? 'Partner',
                },
                structured: structuredAnalysis,
                ...(tradeGrade.graded
                  ? {
                      leagueGrade: {
                        yourLetter: tradeGrade.letter,
                        theirLetter: tradeGrade.partnerLetter,
                        label: tradeGrade.label,
                        youSendLeagueValue: tradeGrade.giveValue,
                        youGetLeagueValue: tradeGrade.getValue,
                      },
                    }
                  : { gradeWithheld: tradeGrade.reason }),
                reasons: review.reasons,
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

  const privateAiDm = await sendPrivateTradeAIDM({
    receiverUserId: userId,
    leagueId,
    proposalId,
    review: {
      verdict: review.verdict,
      summary,
      reasons: review.reasons,
      counterReasons: review.counterReasons,
      declineReasons: review.declineReasons,
      suggestedCounterPackage: review.suggestedCounterPackage,
    },
    trigger: 'review_requested',
  })

  return NextResponse.json({
    ok: true,
    tradeGrade,
    verdict: review.verdict,
    reasons: review.reasons,
    declineReasons: review.declineReasons,
    counterReasons: review.counterReasons,
    summary,
    suggestedCounterPackage: review.suggestedCounterPackage,
    structuredAnalysis,
    aiConfidence,
    privateAiDmSent: privateAiDm.sent,
    privateAiDmCounterSuggestion: privateAiDm.counterSuggestion,
    private: true,
    execution: buildDraftExecutionMetadata({
      feature: 'private_trade_review',
      aiUsed,
      aiEligible: invocation.canShowAIButton,
      reasonCode,
      fallbackToDeterministic: includeAiExplanation && !aiUsed && invocation.decision !== 'deny_dead_button',
    }),
  })
}
