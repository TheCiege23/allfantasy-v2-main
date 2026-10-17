/**
 * Waiver Service — shadow-mode entry point. Fantasy OS Migration Plan
 * Waiver OS foundation, Phase 7. Mirrors Trade OS's TradeShadowService.ts.
 *
 * Computes a waiver evaluation using the provider-neutral context assembler
 * (WaiverContextAssembler.ts) and the Fantasy Knowledge Graph's real manager
 * tendency data (Phase 3), reusing runWaiverAIService's real, already-live
 * deterministic scoring (scoreWaiverCandidates via lib/waiver-engine) as this
 * shadow's own primary recommendation value — no new scoring formula
 * invented. It logged divergence against the one real, independently-
 * computed comparison engine found in the audit
 * (lib/ai/waivers/waiverRecommendationService.ts) until that engine was
 * retired on 2026-09-30; `divergence` is empty until another grader exists.
 *
 * SHADOW MODE ONLY: nothing in this module is called by any live route.
 * Every real dependency call is wrapped so a failure here can never surface
 * as anything worse than a thrown error from this module's own entry point
 * — which by construction has no caller yet, so it cannot break a live flow.
 */

import { randomUUID } from 'crypto'
import { runWaiverAIService } from '@/lib/waiver-ai-engine'
import { buildWaiverDecisionContext, type BuildWaiverDecisionContextInput } from './WaiverContextAssembler'
import { getManagerBehaviorProfile } from '@/lib/shared-services/knowledge-graph/QueryService'
import type { ScoredWaiverTarget, ManagerTendencyContext, WaiverEvaluation, WaiverUrgency } from './types'
import { defaultWaiverShadowResultStore, type WaiverShadowResultStore } from './WaiverShadowResultStore'

async function resolveManagerTendency(managerKey: string | null | undefined): Promise<ManagerTendencyContext> {
  if (!managerKey) {
    return { status: 'unavailable', reason: 'No manager identifier available for this roster.', profile: null }
  }
  try {
    const result = await getManagerBehaviorProfile(managerKey)
    if (result.status === 'gated') {
      return { status: 'gated', reason: result.reason, profile: null }
    }
    return { status: 'ok', reason: null, profile: result.data }
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : 'Knowledge Graph lookup failed.',
      profile: null,
    }
  }
}

const TIER_TO_URGENCY: Record<ScoredWaiverTarget['recommendation'], WaiverUrgency> = {
  'Must Add': 'critical',
  'Strong Add': 'high',
  Add: 'medium',
  Stash: 'low',
  Monitor: 'none',
}

function buildRisk(top: ScoredWaiverTarget | null): WaiverEvaluation['risk'] {
  if (!top?.dropCandidate) return { level: 'low', flags: ['No roster drop required for this add.'] }
  const { riskOfRegret, riskLabel, name } = top.dropCandidate
  const level = riskOfRegret >= 60 ? 'high' : riskOfRegret >= 30 ? 'medium' : 'low'
  return { level, flags: [`Dropping ${name}: ${riskLabel}`] }
}

export interface EvaluateWaiverShadowInput extends BuildWaiverDecisionContextInput {
  /** Injectable for tests; defaults to the process-wide shadow log. */
  resultStore?: WaiverShadowResultStore
}

/**
 * Evaluates one waiver decision in shadow mode. Never called by any live
 * consumer in this phase — this is the capability itself, ready for a future
 * backtest or, eventually, real Waiver OS consolidation to call.
 */
export async function evaluateWaiverShadow(input: EvaluateWaiverShadowInput): Promise<WaiverEvaluation> {
  const resultStore = input.resultStore ?? defaultWaiverShadowResultStore
  const ctx = await buildWaiverDecisionContext(input)

  // runWaiverAIService (→ scoreWaiverCandidates) is this shadow's own primary
  // recommendation value — reused directly, not reinvented. A failure here is
  // NOT caught: the shadow evaluation has nothing meaningful to return without
  // it, and per this module's docstring, nothing live depends on this call yet.
  const primary = await runWaiverAIService(ctx.engineInput)
  const top = primary.deterministic.suggestions[0] ?? null

  const managerTendency = await resolveManagerTendency(ctx.managerKey)

  const totalValued = ctx.dataCompleteness.rosterPlayerCount + ctx.dataCompleteness.valuedFreeAgentCount
  const matchedPct = totalValued > 0 ? (totalValued - ctx.dataCompleteness.unmatchedValuationCount) / totalValued : 1
  const confidence = top ? Math.max(0, Math.min(100, Math.round(Math.min(top.compositeScore, matchedPct * 100)))) : Math.round(matchedPct * 50)

  const uncertainty: string[] = ['TE-premium (isTEP) is not detected and defaults to false — a bounded, documented simplification.']
  if (ctx.dataCompleteness.unmatchedValuationCount > 0) {
    uncertainty.push(`${ctx.dataCompleteness.unmatchedValuationCount} player(s) valued via fallback (no FantasyCalc match).`)
  }
  if (managerTendency.status !== 'ok') {
    uncertainty.push(managerTendency.reason ?? 'Manager tendency data unavailable.')
  }

  const evaluation: WaiverEvaluation = {
    evaluationId: randomUUID(),
    leagueId: ctx.leagueId,
    rosterId: ctx.rosterId,
    platform: ctx.platform,
    evaluatedAt: new Date().toISOString(),
    topCandidate: top ? { playerId: top.playerId, playerName: top.playerName, position: top.position, team: top.team } : null,
    recommendation: {
      score: top?.compositeScore ?? 0,
      tier: top?.recommendation ?? null,
      dropCandidate: top?.dropCandidate ? { name: top.dropCandidate.name, position: top.dropCandidate.position, reason: top.dropCandidate.reason } : null,
    },
    faab: {
      recommendedBid: top?.faabBid ?? null,
      faabRemaining: ctx.faabRemaining,
      faabBudget: ctx.faabBudget,
    },
    priority: {
      rank: top?.priorityRank ?? null,
      waiverType: ctx.waiverType,
    },
    rosterImpact: {
      needs: ctx.needs,
      surplus: ctx.surplus,
    },
    managerTendency,
    urgency: top ? TIER_TO_URGENCY[top.recommendation] : 'none',
    confidence,
    evidence: top?.topDrivers?.map((d) => d.detail) ?? ['No qualifying waiver target was found in the available player pool.'],
    risk: buildRisk(top),
    uncertainty,
    freshness: {
      contextAssembledAt: ctx.assembledAt,
      managerProfileComputedAt: managerTendency.profile ? new Date(managerTendency.profile.computedAt).toISOString() : null,
    },
    sourceAttribution: {
      contextProvider: ctx.platform,
      managerTendencySource: managerTendency.status === 'ok' ? 'knowledge_graph' : 'unavailable',
    },
    /*
     * EMPTY SINCE 2026-09-30: the one legacy grader (waiverRecommendationService, via
     * WaiverRecommendationAdapter) was retired. It read rosters raw and matched roster ids across
     * three id spaces, the decision-engine boundary forbade fixing it in place, and the live route
     * had already moved to the Decision OS engine. The divergence types, result store and analyzer
     * are kept so a future independent grader can plug back in; until then they report nothing.
     */
    divergence: [],
  }

  await resultStore.append(evaluation).catch((err) => {
    console.warn('[waiver-shadow] failed to persist shadow evaluation log (non-fatal):', err)
  })

  return evaluation
}
