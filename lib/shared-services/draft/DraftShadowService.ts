/**
 * Draft Service — shadow-mode entry point. Fantasy OS Migration Plan, Draft
 * OS foundation, Phase 8. Mirrors Trade OS's TradeShadowService.ts and Waiver
 * OS's WaiverShadowService.ts.
 *
 * Reuses lib/draft-helper/RecommendationEngine.ts's real, already-live
 * computeDraftRecommendation() as this shadow's own primary value — no new
 * scoring formula invented — and logs divergence against the one real,
 * independently-computed comparison engine found in the audit
 * (lib/ai/opponents/draft/aiOpponentDraft.ts).
 *
 * SHADOW MODE ONLY: nothing in this module is called by any live route.
 * Every real dependency call is wrapped so a failure here can never surface
 * as anything worse than a thrown error from this module's own entry point
 * — which by construction has no caller yet, so it cannot break a live flow.
 */

import { randomUUID } from 'crypto'
import { computeDraftRecommendation } from '@/lib/draft-helper/RecommendationEngine'
import { buildDraftDecisionContext, type BuildDraftDecisionContextInput, type DraftDecisionContext } from './DraftContextAssembler'
import { runLegacyDraftGrader } from './DraftRecommendationAdapter'
import { getManagerBehaviorProfile, getPlayerExposure } from '@/lib/shared-services/knowledge-graph/QueryService'
import type { DraftEvaluation, DraftGraderDivergence, ManagerTendencyContext, PlayerExposureContext } from './types'
import { defaultDraftShadowResultStore, type DraftShadowResultStore } from './DraftShadowResultStore'

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

async function resolvePlayerExposure(managerKey: string | null | undefined, playerId: string | null | undefined): Promise<PlayerExposureContext> {
  if (!managerKey) {
    return { status: 'unavailable', reason: 'No manager identifier available for this roster.', exposure: null }
  }
  if (!playerId) {
    return { status: 'unavailable', reason: 'No resolvable player identity for the top candidate.', exposure: null }
  }
  try {
    const result = await getPlayerExposure(managerKey, playerId)
    if (result.status === 'gated') {
      return { status: 'gated', reason: result.reason, exposure: null }
    }
    return { status: 'ok', reason: null, exposure: result.data }
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : 'Knowledge Graph lookup failed.',
      exposure: null,
    }
  }
}

function buildDivergence(
  shadowTop: { playerId: string | null; playerName: string; confidence: number } | null,
  legacy: Awaited<ReturnType<typeof runLegacyDraftGrader>>
): DraftGraderDivergence {
  const notes: string[] = []
  if (legacy.error) notes.push(legacy.error)

  const shadowTopPlayerId = shadowTop?.playerId ?? null
  const sameTopPlayer = legacy.error ? null : shadowTopPlayerId === legacy.topPlayerId
  if (sameTopPlayer === false) notes.push('Legacy and shadow recommend different top players.')

  return {
    graderId: legacy.graderId,
    legacyTopPlayerId: legacy.topPlayerId,
    legacyTopPlayerName: legacy.topPlayerName,
    legacyConfidence: legacy.confidence,
    shadowTopPlayerId,
    shadowTopPlayerName: shadowTop?.playerName ?? null,
    shadowConfidence: shadowTop?.confidence ?? null,
    sameTopPlayer,
    notes,
  }
}

function buildRisk(reachWarning: string | null, valueWarning: string | null): DraftEvaluation['risk'] {
  const flags: string[] = []
  if (reachWarning) flags.push(reachWarning)
  if (valueWarning) flags.push(valueWarning)
  if (flags.length === 0) return { level: 'low', flags: ['No reach or value warning for this pick.'] }
  return { level: flags.length > 1 ? 'high' : 'medium', flags }
}

export interface EvaluateDraftShadowInput extends BuildDraftDecisionContextInput {
  /** Injectable for tests; defaults to the process-wide shadow log. */
  resultStore?: DraftShadowResultStore
}

/**
 * Evaluates one draft-pick decision in shadow mode, given an already-built
 * DraftDecisionContext. Exported separately from evaluateDraftShadow so the
 * backtest (backtest/DraftBacktestRunner.ts) can reuse this exact evaluation
 * logic — KG lookups, divergence, evidence/risk/uncertainty assembly — against
 * a POINT-IN-TIME historical context it reconstructs itself (a real capability
 * Draft OS has that Waiver OS's backtest didn't: draft picks are strictly
 * ordered, so "all picks before overall N" is a faithful historical
 * snapshot, not an approximation).
 */
export async function evaluateDraftShadowFromContext(
  ctx: DraftDecisionContext,
  resultStore: DraftShadowResultStore = defaultDraftShadowResultStore
): Promise<DraftEvaluation> {
  // computeDraftRecommendation is this shadow's own primary recommendation
  // value — reused directly, not reinvented. A failure here is NOT caught:
  // the shadow evaluation has nothing meaningful to return without it, and
  // per this module's docstring, nothing live depends on this call yet.
  const primary = computeDraftRecommendation(ctx.engineInput)
  const top = primary.recommendation

  const legacy = await runLegacyDraftGrader(ctx)
  const topKey = top ? `${top.player.name.trim().toLowerCase()}|${top.player.position.trim().toLowerCase()}` : null
  const topPlayerId = topKey ? ctx.playerIdByKey.get(topKey) ?? null : null

  const [managerTendency, playerExposure] = await Promise.all([
    resolveManagerTendency(ctx.managerKey),
    resolvePlayerExposure(ctx.managerKey, topPlayerId),
  ])

  const uncertainty: string[] = []
  if (ctx.dataCompleteness.unresolvedPlayerIdCount > 0) {
    uncertainty.push(`${ctx.dataCompleteness.unresolvedPlayerIdCount} available player(s) have no resolvable sport-pool identity — KG lookups and the legacy grader use a synthetic key for those.`)
  }
  if (managerTendency.status !== 'ok') uncertainty.push(managerTendency.reason ?? 'Manager tendency data unavailable.')
  if (playerExposure.status !== 'ok') uncertainty.push(playerExposure.reason ?? 'Player exposure data unavailable.')

  const shadowTopForDivergence = top ? { playerId: topPlayerId, playerName: top.player.name, confidence: top.confidence } : null

  const evaluation: DraftEvaluation = {
    evaluationId: randomUUID(),
    leagueId: ctx.leagueId,
    rosterId: ctx.rosterId,
    sessionId: ctx.sessionId,
    platform: ctx.platform,
    evaluatedAt: new Date().toISOString(),
    draftState: { round: ctx.round, pick: ctx.pick, totalTeams: ctx.totalTeams, status: ctx.status },
    topCandidate: top
      ? { playerId: topPlayerId, playerName: top.player.name, position: top.player.position, team: top.player.team ?? null }
      : null,
    recommendation: {
      score: top?.confidence ?? 0,
      reason: top?.reason ?? primary.explanation,
      needScore: top?.needScore ?? 0,
      adpEdge: top?.adpEdge ?? 0,
    },
    alternatives: primary.alternatives.map((a) => ({
      playerName: a.player.name,
      position: a.player.position,
      reason: a.reason,
      confidence: a.confidence,
    })),
    positionalImpact: {
      reachWarning: primary.reachWarning,
      valueWarning: primary.valueWarning,
      scarcityInsight: primary.scarcityInsight,
      formatInsight: primary.formatInsight,
    },
    draftValue: {
      adp: top?.player.adp ?? null,
      overallPickAtEvaluation: ctx.pick,
    },
    scarcityImpact: {
      insight: primary.scarcityInsight,
    },
    opportunityCost: {
      alternativesForegone: primary.alternatives.slice(0, 2).map((a) => `${a.player.name} (${a.player.position})`),
    },
    managerTendency,
    playerExposure,
    confidence: top?.confidence ?? 0,
    evidence: primary.evidence.length > 0 ? primary.evidence : ['No qualifying draft recommendation was found in the available player pool.'],
    risk: buildRisk(primary.reachWarning, primary.valueWarning),
    uncertainty,
    freshness: {
      contextAssembledAt: ctx.assembledAt,
      managerProfileComputedAt: managerTendency.profile ? new Date(managerTendency.profile.computedAt).toISOString() : null,
      playerExposureComputedAt: playerExposure.exposure ? new Date(playerExposure.exposure.computedAt).toISOString() : null,
    },
    sourceAttribution: {
      contextProvider: ctx.platform,
      managerTendencySource: managerTendency.status === 'ok' ? 'knowledge_graph' : 'unavailable',
      playerExposureSource: playerExposure.status === 'ok' ? 'knowledge_graph' : 'unavailable',
    },
    divergence: [buildDivergence(shadowTopForDivergence, legacy)],
  }

  await resultStore.append(evaluation).catch((err) => {
    console.warn('[draft-shadow] failed to persist shadow evaluation log (non-fatal):', err)
  })

  return evaluation
}

/**
 * Evaluates one draft-pick decision in shadow mode, for the CURRENT (live)
 * state of a league's draft session. Never called by any live consumer in
 * this phase — this is the capability itself, ready for a future backtest or,
 * eventually, real Draft OS consolidation to call.
 */
export async function evaluateDraftShadow(input: EvaluateDraftShadowInput): Promise<DraftEvaluation> {
  const resultStore = input.resultStore ?? defaultDraftShadowResultStore
  const ctx = await buildDraftDecisionContext(input)
  return evaluateDraftShadowFromContext(ctx, resultStore)
}
