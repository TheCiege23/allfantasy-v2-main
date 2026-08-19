/**
 * POST /api/draft/recommend — deterministic draft recommendation.
 * Uses only provided pool and draft state; no invented players. For live and mock draft.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runDraftAIAssist } from '@/lib/draft-ai-engine'
import { resolveSportForAI } from '@/lib/ai/AISportContextResolver'
import { resolveSportVariantContext } from '@/lib/league-defaults-orchestrator/SportVariantContextResolver'
import { buildDraftExecutionMetadata } from '@/lib/draft-automation-policy'
import { buildDraftRecommendationContext } from '@/lib/ai/SportAwareRecommendationService'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { TokenSpendService } from '@/lib/tokens/TokenSpendService'
import { shouldRunShadow } from '@/lib/decision-os/core/shadow'
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import { evaluateDraftShadow } from '@/lib/shared-services/draft'
import { getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null }
  } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const available = Array.isArray(body.available) ? body.available : []
  const teamRoster = Array.isArray(body.teamRoster) ? body.teamRoster : []
  const rosterSlots = Array.isArray(body.rosterSlots) ? body.rosterSlots : []
  const round = Math.max(1, Number(body.round) || 1)
  const pick = Math.max(1, Number(body.pick) || 1)
  const totalTeams = Math.max(2, Math.min(24, Number(body.totalTeams) || 12))
  const leagueVariant =
    typeof body.leagueVariant === 'string'
      ? body.leagueVariant
      : typeof body.league_variant === 'string'
        ? body.league_variant
        : null
  const variantContext = resolveSportVariantContext(resolveSportForAI(body as Record<string, unknown>), leagueVariant)
  const sport = variantContext.sport
  const isDynasty = Boolean(body.isDynasty)
  const isSF = Boolean(body.isSF)
  const isIdp = variantContext.isFootballIdp || variantContext.isNflIdp || Boolean(body.idp) || Boolean(body.is_idp)
  const includeAIExplanation = Boolean(body.includeAIExplanation ?? body.includeAiExplanation)
  const mode = body.mode === 'bpa' ? 'bpa' : 'needs'
  const aiAdpByKey = body.aiAdpByKey && typeof body.aiAdpByKey === 'object' ? body.aiAdpByKey : undefined
  const byeByKey = body.byeByKey && typeof body.byeByKey === 'object' ? body.byeByKey : undefined

  let tokenFallbackLedgerId: string | null = null
  let tokenFallbackRuleCode: string | null = null
  let tokenFallbackCost: number | null = null
  if (includeAIExplanation) {
    const gate = await requireFeatureEntitlement({
      userId: session.user.id,
      userEmail: session.user.email,
      featureId: 'draft_prep',
      allowTokenFallback: true,
      confirmTokenSpend: Boolean(body.confirmTokenSpend),
      tokenRuleCode: 'ai_draft_pick_explanation',
      tokenSourceType: 'draft_prep_ai_explanation',
      tokenSourceId: `${typeof body.leagueId === 'string' ? body.leagueId : 'draft'}:${Date.now()}`,
      tokenDescription: 'Draft prep AI explanation fallback',
      tokenMetadata: {
        leagueId: typeof body.leagueId === 'string' ? body.leagueId : null,
        round,
        pick,
      },
    })
    if (!gate.ok) return gate.response
    if (gate.tokenSpend) {
      tokenFallbackLedgerId = gate.tokenSpend.id
      tokenFallbackRuleCode = gate.tokenSpend.spendRuleCode
      tokenFallbackCost = Math.abs(gate.tokenSpend.tokenDelta)
    }
  }

  const normalized = available.slice(0, 200).map((p: any) => ({
    name: String(p.name ?? p.playerName ?? ''),
    position: String(p.position ?? ''),
    team: p.team ?? null,
    adp: p.adp ?? p.rank ?? null,
    byeWeek: p.byeWeek ?? null,
    // Draft VORP slice: real projections from the client pool when present
    // (draft room pool rows carry projectedPoints). Never invented.
    projectedPoints:
      typeof p.projectedPoints === 'number' && Number.isFinite(p.projectedPoints)
        ? p.projectedPoints
        : typeof p.projPts === 'number' && Number.isFinite(p.projPts)
          ? p.projPts
          : null,
  }))

  try {
    const result = await runDraftAIAssist({
      available: normalized,
      teamRoster,
      rosterSlots,
      round,
      pick,
      totalTeams,
      sport,
      isDynasty,
      isSF,
      mode,
      aiAdpByKey,
      byeByKey: byeByKey ?? (normalized.length ? Object.fromEntries(
        normalized.filter((p: any) => p.byeWeek != null).map((p: any) => [
          `${(p.name || '').toLowerCase()}|${(p.position || '').toLowerCase()}|${(p.team || '').toLowerCase()}`,
          p.byeWeek,
        ])
      ) : undefined),
    }, {
      explanation: includeAIExplanation,
      sport,
      idp: isIdp,
      recommendationContext: buildDraftRecommendationContext({
        sport,
        format: isDynasty ? 'dynasty' : 'redraft',
        superflex: isSF,
        idp: isIdp,
        numTeams: totalTeams,
        leagueName: typeof body.leagueName === 'string' ? body.leagueName : undefined,
        assistantFeedBrief:
          typeof body.assistantFeedBrief === 'string' && body.assistantFeedBrief.trim()
            ? body.assistantFeedBrief.trim().slice(0, 600)
            : undefined,
      }),
      leagueId: typeof body.leagueId === 'string' ? body.leagueId : undefined,
    })

    const aiUsed = Boolean(result.aiExplanationUsed)
    const fallbackToDeterministic = includeAIExplanation && !aiUsed

    // Slice 10 — Draft OS shadow: the FIRST production caller of
    // lib/shared-services/draft (previously test-only scaffolding). Gated by
    // DECISION_OS_DRAFT_SHADOW (default OFF); fire-and-forget with its own
    // error isolation — can never affect the live recommendation response.
    // Emits `manager.draft.pick` parity: shared-service top pick vs the live
    // engine's top pick, the sample stream for eventual Draft OS convergence.
    const shadowLeagueId = typeof body.leagueId === 'string' ? body.leagueId : null
    if (shadowLeagueId && shouldRunShadow('DECISION_OS_DRAFT_SHADOW')) {
      const liveTop = result.recommendation.recommendation?.player?.name ?? null
      const liveConfidence = result.recommendation.recommendation?.confidence ?? null
      const userId = session.user.id
      void (async () => {
        try {
          const rosterId = await getCurrentUserRosterIdForLeague(shadowLeagueId, userId)
          if (!rosterId) {
            emitShadowParity('manager.draft.pick', { shadow: true, ran: false, reason: 'no_user_roster' })
            return
          }
          const evaluation = await evaluateDraftShadow({ leagueId: shadowLeagueId, rosterId, mode })
          const shadowTop = evaluation.topCandidate?.playerName ?? null
          emitShadowParity('manager.draft.pick', {
            shadow: true,
            ran: true,
            reason: 'shared_service_compare',
            sameTopPlayer:
              shadowTop && liveTop ? shadowTop.trim().toLowerCase() === liveTop.trim().toLowerCase() : null,
            shadowTop,
            liveTop,
            shadowConfidence: evaluation.confidence,
            liveConfidence,
            uncertaintyCount: evaluation.uncertainty.length,
          })
        } catch {
          emitShadowParity('manager.draft.pick', { shadow: true, ran: false, reason: 'shadow_error' })
        }
      })()
    }

    return NextResponse.json({
      ok: true,
      recommendation: result.recommendation.recommendation,
      alternatives: result.recommendation.alternatives,
      reachWarning: result.recommendation.reachWarning,
      valueWarning: result.recommendation.valueWarning,
      scarcityInsight: result.recommendation.scarcityInsight,
      stackInsight: result.recommendation.stackInsight,
      correlationInsight: result.recommendation.correlationInsight,
      formatInsight: result.recommendation.formatInsight,
      byeNote: result.recommendation.byeNote,
      explanation: result.explanation ?? result.recommendation.explanation,
      evidence: result.recommendation.evidence,
      caveats: result.recommendation.caveats,
      uncertainty: result.recommendation.uncertainty,
      execution: buildDraftExecutionMetadata({
        feature: 'draft_helper_recommendation_engine',
        aiUsed,
        aiEligible: true,
        reasonCode: aiUsed
          ? 'ai_explanation_applied'
          : includeAIExplanation
            ? 'ai_explanation_unavailable'
            : 'deterministic_rules_engine',
        fallbackToDeterministic,
      }),
      tokenSpend: tokenFallbackLedgerId
        ? {
            ruleCode: tokenFallbackRuleCode,
            tokenCost: tokenFallbackCost,
            ledgerId: tokenFallbackLedgerId,
          }
        : null,
    })
  } catch (error) {
    if (tokenFallbackLedgerId) {
      await new TokenSpendService()
        .refundSpendByLedger({
          userId: session.user.id,
          spendLedgerId: tokenFallbackLedgerId,
          refundRuleCode: 'feature_execution_failed',
          sourceType: 'draft_recommend_ai_explanation_refund',
          sourceId: tokenFallbackLedgerId,
          idempotencyKey: `refund:draft_recommend:${tokenFallbackLedgerId}`,
          description: 'Auto refund after failed draft recommendation request.',
          metadata: {
            leagueId: typeof body.leagueId === 'string' ? body.leagueId : null,
            round,
            pick,
          },
        })
        .catch(() => null)
    }
    console.error('[draft/recommend POST]', error)
    return NextResponse.json({ error: 'Failed to generate draft recommendation' }, { status: 500 })
  }
}
