/**
 * Trade Service — shadow-mode entry point. Fantasy OS Migration Plan
 * Milestone 4, first real step of Trade OS consolidation.
 *
 * Computes a trade evaluation using the provider-neutral context assembler
 * (Phase 4) and the Fantasy Knowledge Graph's real manager tendency data
 * (Phase 3), reusing trade-engine.ts's real computeTradeDrivers() as the
 * shadow's own fairness/grade value (no new scoring formula invented — see
 * LegacyGraderAdapters.ts's docstring for why), and logs divergence against
 * T2's real, independently-computed gradeTrade().
 *
 * SHADOW MODE ONLY: nothing in this module is called by any live route.
 * Every real dependency call is wrapped so a failure here can never surface
 * as anything worse than a thrown error from this module's own entry point
 * — which by construction has no caller yet, so it cannot break a live flow.
 */

import { randomUUID } from 'crypto'
import { buildLeagueDecisionContext, deriveTradeDecisionContext, leagueContextToIntelligence } from '@/lib/trade-engine/league-context-assembler'
import type { BuildLeagueContextInput } from '@/lib/trade-engine/league-context-assembler'
import { runT2Grader } from './LegacyGraderAdapters'
import { computeTradeDrivers } from '@/lib/trade-engine/trade-engine'
import { assembleShadowEvaluation } from './ShadowEvaluationEngine'
import { getManagerBehaviorProfile } from '@/lib/shared-services/knowledge-graph/QueryService'
import type { ManagerTendencyContext, TradeShadowEvaluation } from './types'
import { defaultShadowResultStore, type ShadowResultStore } from './ShadowResultStore'

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

export interface EvaluateTradeShadowInput extends BuildLeagueContextInput {
  sideARosterId: string
  sideBRosterId: string
  sideAAssetNames: string[]
  sideBAssetNames: string[]
  /** Injectable for tests; defaults to the process-wide shadow log. */
  resultStore?: ShadowResultStore
}

/**
 * Evaluates one trade in shadow mode. Never called by any live consumer in
 * this phase — this is the capability itself, ready for a future backtest
 * script or, eventually, real Trade OS consolidation to call.
 */
export async function evaluateTradeShadow(input: EvaluateTradeShadowInput): Promise<TradeShadowEvaluation> {
  const resultStore = input.resultStore ?? defaultShadowResultStore

  const leagueCtx = await buildLeagueDecisionContext({
    leagueId: input.leagueId,
    username: input.username,
    platform: input.platform,
    userId: input.userId,
  })

  const tradeCtx = deriveTradeDecisionContext(
    leagueCtx,
    input.sideARosterId,
    input.sideBRosterId,
    input.sideAAssetNames,
    input.sideBAssetNames
  )

  const { intelligence } = leagueContextToIntelligence(leagueCtx)

  const teamA = leagueCtx.teams.find((t) => t.teamId === input.sideARosterId)
  const teamB = leagueCtx.teams.find((t) => t.teamId === input.sideBRosterId)
  if (!teamA || !teamB) {
    throw new Error(`Teams not found in league context: ${input.sideARosterId}, ${input.sideBRosterId}`)
  }

  const sideANames = new Set(input.sideAAssetNames.map((n) => n.trim().toLowerCase()))
  const sideBNames = new Set(input.sideBAssetNames.map((n) => n.trim().toLowerCase()))
  const give = (intelligence.assetsByRosterId[teamA.rosterId] ?? []).filter((a) => sideANames.has((a.name ?? '').toLowerCase()))
  const receive = (intelligence.assetsByRosterId[teamB.rosterId] ?? []).filter((a) => sideBNames.has((a.name ?? '').toLowerCase()))
  const fromManager = intelligence.managerProfiles[teamA.rosterId] ?? null
  const toManager = intelligence.managerProfiles[teamB.rosterId] ?? null

  // trade-engine.ts's real computeTradeDrivers() is this shadow's own primary
  // fairness/grade value — reused directly, not reinvented. A failure here is
  // NOT caught: the shadow evaluation has nothing meaningful to return without
  // it, and per this module's docstring, nothing live depends on this call yet.
  const drivers = computeTradeDrivers(give, receive, fromManager, toManager, leagueCtx.leagueConfig.isSF, leagueCtx.leagueConfig.isTEP)

  const t2Result = runT2Grader(input.sideARosterId, input.sideBRosterId, tradeCtx.sideA.assets, tradeCtx.sideB.assets)

  const [sideATendency, sideBTendency] = await Promise.all([
    resolveManagerTendency(teamA.userId),
    resolveManagerTendency(teamB.userId),
  ])

  const evaluation = assembleShadowEvaluation({
    evaluationId: randomUUID(),
    leagueId: input.leagueId,
    provider: (leagueCtx.leagueConfig.platform as EvaluateTradeShadowInput['platform']) as any,
    contextAssembledAt: leagueCtx.assembledAt,
    tradeCtx,
    drivers,
    t2Result,
    sideATendency,
    sideBTendency,
  })

  await resultStore.append(evaluation).catch((err) => {
    console.warn('[trade-shadow] failed to persist shadow evaluation log (non-fatal):', err)
  })

  return evaluation
}
