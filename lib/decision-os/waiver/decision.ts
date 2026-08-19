/**
 * Decision OS — Waiver Intelligence for `manager.waiver.claim` (Slice 2).
 *
 * ARCHITECTURE RULE: this module consumes ONLY the DCO + injected dependencies. It performs NO direct
 * prisma / league / settings reads — the recommender (runWaiverAIService) and the Rule Framework are
 * injected. It WRAPS the canonical recommender (does not rewrite it), uses ONLY the deterministic
 * suggestions (optional AI prose is ignored), and maps the output into a Decision Object that answers
 * the four contract questions.
 */
import { assertFourAnswers, isLegal, type Decision, type RuleVerdict } from '@/lib/decision-os/core/decision'
import { emitDecisionTelemetry } from '@/lib/decision-os/core/telemetry'
import type { WaiverAIServiceInput, WaiverAIServiceOutput } from '@/lib/waiver-ai-engine'
import type { ScoredWaiverTarget } from '@/lib/waiver-engine/waiver-scoring'
import type { WaiverDCO } from './dco'
import { evaluateWaiverRules, type WaiverRuleDeps } from './rules'

/** A Decision OS waiver claim recommendation (mapped from a deterministic ScoredWaiverTarget). */
export interface WaiverClaimRecommendation {
  addPlayerId: string
  addPlayerName: string
  position: string
  team: string | null
  dropPlayerId: string | null
  dropPlayerName: string | null
  faabBid: number | null
  priorityRank: number
  compositeScore: number
  recommendation: ScoredWaiverTarget['recommendation']
  reason: string
}

export interface WaiverDecisionDeps {
  /** The canonical recommender (runWaiverAIService) — injected; does the deterministic scoring. */
  recommend: (input: WaiverAIServiceInput) => Promise<WaiverAIServiceOutput>
  ruleDeps: WaiverRuleDeps
  newId?: () => string
  lifecyclePhase?: string
}

/** Map a deterministic suggestion → a claim recommendation. The engine suggests a drop by name only. */
export function suggestionToRecommendation(s: ScoredWaiverTarget): WaiverClaimRecommendation {
  return {
    addPlayerId: s.playerId,
    addPlayerName: s.playerName,
    position: s.position,
    team: s.team,
    dropPlayerId: null,
    dropPlayerName: s.dropCandidate?.name ?? null,
    faabBid: s.faabBid,
    priorityRank: s.priorityRank,
    compositeScore: s.compositeScore,
    recommendation: s.recommendation,
    reason: s.topDrivers?.[0]?.detail ?? s.dropCandidate?.reason ?? s.recommendation,
  }
}

function deriveConfidence(top: WaiverClaimRecommendation | undefined, dataCompleteness: number): number {
  if (!top) return Math.min(70, dataCompleteness)
  // compositeScore is already 0–100; cap by data completeness (honesty).
  return Math.max(0, Math.min(100, Math.round(Math.min(top.compositeScore, dataCompleteness))))
}

function howConfident(confidence: number, dataCompleteness: number, uncertainty: string[]): string {
  const band = confidence >= 80 ? 'High' : confidence >= 50 ? 'Medium' : 'Low'
  const caveat = uncertainty.length
    ? ` (${dataCompleteness < 100 ? 'data partial — ' : ''}${uncertainty[0].toLowerCase().replace(/\.$/, '')})`
    : ''
  return `${band} confidence${caveat}.`
}

/**
 * Produce the `manager.waiver.claim` Decision from the DCO. Consumes only the DCO + deps.
 */
export async function decideWaiverClaim(dco: WaiverDCO, deps: WaiverDecisionDeps): Promise<Decision<WaiverClaimRecommendation>> {
  const newId = deps.newId ?? (() => `dec_${Math.random().toString(36).slice(2)}`)

  // 1) Recommendation (canonical recommender, injected) — deterministic suggestions ONLY.
  const output = await deps.recommend(dco.engineInput)
  const suggestions = output.deterministic?.suggestions ?? []
  const recommendations = suggestions.map(suggestionToRecommendation)
  const top = recommendations[0]

  // 2) Rules (validity before optimality) — gate the TOP candidate claim against the World.
  let verdicts: RuleVerdict[] = []
  if (top) {
    verdicts = await evaluateWaiverRules(
      { claim: { addPlayerId: top.addPlayerId, dropPlayerId: top.dropPlayerId, faabBid: top.faabBid }, world: dco.world },
      deps.ruleDeps,
    )
  }
  const illegal = verdicts.filter((v) => v.verdict === 'illegal')
  const blocked = verdicts.filter((v) => v.verdict === 'temporarily_illegal')

  // 3) Four answers (grounded in the DCO + recommender + verdicts).
  const data_completeness = dco.data_completeness
  const confidence = deriveConfidence(top, data_completeness)
  const uncertainty = [...dco.uncertainty]
  const how_confident = howConfident(confidence, data_completeness, uncertainty)

  const what_happened = !top
    ? 'No waiver claim is recommended right now — no qualifying targets.'
    : `${recommendations.length} waiver target(s) ranked; top add is ${top.addPlayerName} (${top.position}).`
  const why_it_matters = !top
    ? 'Your available pool produced no add that improves your roster enough to recommend.'
    : illegal.length
      ? illegal[0].message
      : `${top.recommendation} — ${top.reason}`
  const what_to_do = !top
    ? 'Hold your FAAB/priority; re-check when the pool refreshes.'
    : illegal.length
      ? illegal[0].message
      : blocked.length
        ? blocked[0].message
        : `Claim ${top.addPlayerName}${top.faabBid != null ? ` for $${top.faabBid} FAAB` : ''}${top.dropPlayerName ? `, dropping ${top.dropPlayerName}` : ''}.`

  const decision: Decision<WaiverClaimRecommendation> = {
    decision_id: newId(),
    decision_type: 'manager.waiver.claim',
    decider_scope: 'user',
    lifecycle_phase: deps.lifecyclePhase ?? 'active',
    four_answers: { what_happened, why_it_matters, how_confident, what_to_do },
    recommended_actions: recommendations,
    rule_verdicts: verdicts,
    confidence,
    data_completeness,
    uncertainty_sources: Array.from(new Set(uncertainty)),
    provenance: dco.provenance,
    automation_capable: false, // Slice 2: Decision OS never executes a claim (shadow-only)
    explanation: !top ? what_happened : `${why_it_matters} ${what_to_do}`,
    telemetry: {
      dco_consumed: true,
      rule_gated: true,
      decision_object_emitted: true,
      explainable: true,
      world_resolution_read_only: true,
    },
  }

  assertFourAnswers(decision)
  emitDecisionTelemetry(
    'decision.issued',
    decision.decision_type,
    {
      ...decision.telemetry,
      legal: isLegal(verdicts),
      userId: dco.user.userId,
      leagueId: dco.league.leagueId,
      rosterId: dco.roster.rosterId,
    },
    decision.decision_id,
  )
  return decision
}
