/**
 * Commissioner Shadow Service — Phase 10. Orchestrates the whole shared
 * service for one league: assembles context (reusing real Mission
 * Control/League Analytics), builds League Pulse, League Health, Attention
 * Queue, Power Rankings, and a structured Commissioner Brief, then records
 * divergence against the one real comparable existing engine
 * (resolveAttentionQueueSnapshot).
 *
 * SHADOW MODE ONLY: nothing in this module is called by any live route.
 * Every real dependency call already fails safe (Mission Control/League
 * Analytics never throw); this module adds no new unguarded failure path.
 */

import { randomUUID } from 'crypto'
import { buildCommissionerContext, type BuildCommissionerContextInput } from './CommissionerContextAssembler'
import { buildLeaguePulse } from './LeaguePulseService'
import { buildLeagueHealthAssessment } from './LeagueHealthService'
import { buildCommissionerAttentionItems } from './CommissionerAttentionService'
import { buildCommissionerRanking } from './CommissionerRankingService'
import { buildCommissionerBrief } from './CommissionerBriefService'
import { analyzeCommissionerDivergence } from './CommissionerDivergenceAnalyzer'
import { defaultCommissionerShadowResultStore, type CommissionerShadowResultStore } from './CommissionerShadowResultStore'
import type { CommissionerShadowEvaluation } from './types'

export interface EvaluateCommissionerShadowInput extends BuildCommissionerContextInput {
  week?: number
  resultStore?: CommissionerShadowResultStore
}

export async function evaluateCommissionerShadow(input: EvaluateCommissionerShadowInput): Promise<CommissionerShadowEvaluation> {
  const resultStore = input.resultStore ?? defaultCommissionerShadowResultStore

  const context = await buildCommissionerContext(input)
  const pulse = buildLeaguePulse(context)
  const health = buildLeagueHealthAssessment(context)
  const attentionItems = buildCommissionerAttentionItems(context)
  const ranking = await buildCommissionerRanking(context, input.week)
  const brief = buildCommissionerBrief(context, ranking, attentionItems)

  let divergence: CommissionerShadowEvaluation['divergence'] = []
  try {
    divergence = await analyzeCommissionerDivergence({ leagueId: input.leagueId, myAttentionItems: attentionItems })
  } catch (err) {
    console.warn('[commissioner-shadow] divergence analysis failed (non-fatal):', err)
  }

  const evaluation: CommissionerShadowEvaluation = {
    evaluationId: randomUUID(),
    leagueId: input.leagueId,
    generatedAt: new Date().toISOString(),
    context,
    pulse,
    health,
    attentionItems,
    ranking,
    brief,
    divergence,
  }

  await resultStore.append(evaluation).catch((err) => {
    console.warn('[commissioner-shadow] failed to persist shadow evaluation (non-fatal):', err)
  })

  return evaluation
}
