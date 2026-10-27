/**
 * Decision OS — `manager.draft.pick`.
 *
 * WRAPS the draft recommender (`computeDraftRecommendation`, the engine behind `/api/draft/recommend`
 * and Draft OS) — it does not rank players itself — gates the top choice through the live pick
 * rules, and answers the four contract questions. Consumes only the DCO + injected deps.
 *
 * Never makes a pick (`automation_capable: false`): the manager drafts, and Chimmy AI managers draft
 * through their own path (`executeDraftPickForOrphan`).
 */
import { assertFourAnswers, isLegal, type Decision, type RuleVerdict } from '@/lib/decision-os/core/decision'
import { emitDecisionTelemetry } from '@/lib/decision-os/core/telemetry'
import type { RecommendationInput, RecommendationResult } from '@/lib/draft-helper/RecommendationEngine'
import type { DraftDCO } from './dco'
import { evaluateDraftPickRules, type DraftRuleDeps } from './rules'

/** How many players the decision carries: the top choice plus alternatives. */
export const DRAFT_DECISION_MAX_ACTIONS = 4

export interface DraftPickRecommendation {
  rank: number
  playerName: string
  position: string
  team: string | null
  adp: number | null
  /**
   * Whether `adp` is a real market value. Only known for the top choice (the engine reports it
   * there); null on alternatives, which must not be described as reaches or values against ADP.
   */
  adpIsReal: boolean | null
  reason: string
  /** 0–100 from the engine. */
  confidence: number
}

export interface DraftDecisionDeps {
  recommend: (input: RecommendationInput) => RecommendationResult
  ruleDeps: DraftRuleDeps
  newId?: () => string
}

function band(confidence: number): 'High' | 'Medium' | 'Low' {
  return confidence >= 80 ? 'High' : confidence >= 50 ? 'Medium' : 'Low'
}

function describe(p: DraftPickRecommendation): string {
  return `${p.playerName} (${p.position}${p.team ? `, ${p.team}` : ''})`
}

export function toDraftPickRecommendations(result: RecommendationResult): DraftPickRecommendation[] {
  const out: DraftPickRecommendation[] = []
  const top = result.recommendation
  if (top) {
    out.push({
      rank: 1,
      playerName: top.player.name,
      position: top.player.position,
      team: top.player.team ?? null,
      adp: top.player.adp ?? null,
      adpIsReal: top.adpIsReal,
      reason: top.reason,
      confidence: top.confidence,
    })
  }
  for (const alt of result.alternatives) {
    if (out.length >= DRAFT_DECISION_MAX_ACTIONS) break
    out.push({
      rank: out.length + 1,
      playerName: alt.player.name,
      position: alt.player.position,
      team: alt.player.team ?? null,
      adp: alt.player.adp ?? null,
      adpIsReal: null,
      reason: alt.reason,
      confidence: alt.confidence,
    })
  }
  return out
}

export async function decideDraftPick(dco: DraftDCO, deps: DraftDecisionDeps): Promise<Decision<DraftPickRecommendation>> {
  const newId = deps.newId ?? (() => `dec_${Math.random().toString(36).slice(2)}`)
  const { world } = dco

  // 1) Recommendation (wrapped engine).
  const result = deps.recommend(dco.engineInput)
  const actions = toDraftPickRecommendations(result)
  const top = actions[0]

  // 2) Rules — gate the top choice against the live draft.
  const verdicts: RuleVerdict[] = top
    ? await evaluateDraftPickRules({ candidate: { playerName: top.playerName, position: top.position }, world }, deps.ruleDeps)
    : []
  const illegal = verdicts.filter((v) => v.verdict === 'illegal')
  const waiting = verdicts.filter((v) => v.verdict === 'temporarily_illegal')

  // 3) Four answers.
  const data_completeness = dco.data_completeness
  const confidence = top ? Math.max(0, Math.min(100, Math.round(Math.min(top.confidence, data_completeness)))) : 0
  const uncertainty = [...dco.uncertainty]
  if (top && top.adpIsReal === false) uncertainty.push('The top choice has no market ADP, so reach and value against ADP are unknown.')

  const pickLabel = world.currentOverall != null ? `pick ${world.currentOverall}` : 'your next pick'
  const what_happened = top
    ? `${actions.length} player${actions.length === 1 ? '' : 's'} ranked for ${pickLabel}; the top choice is ${describe(top)}.`
    : dco.coverage.availablePoolSize === 0
      ? 'No player could be ranked: the available pool for this draft is empty.'
      : 'No player could be recommended from the available pool.'
  const why_it_matters = !top
    ? 'Without a ranked pool there is no recommendation to make, which is not a judgement on the players left.'
    : illegal.length > 0
      ? illegal[0].message
      : top.reason
  const how_confident = `${band(confidence)} confidence${
    uncertainty.length > 0 ? ` (${data_completeness < 100 ? 'data partial — ' : ''}${uncertainty[0].toLowerCase().replace(/\.$/, '')})` : ''
  }.`
  const nextLegal = actions.slice(1)[0]
  const what_to_do = !top
    ? 'Pick from your queue or the board; refresh once the player pool loads.'
    : illegal.length > 0
      ? illegal[0].rule === 'draft.legality.complete'
        ? 'Review your roster in the draft results.'
        : nextLegal
          ? `Skip ${top.playerName}; consider ${describe(nextLegal)} instead.`
          : `Skip ${top.playerName} and pick from the board.`
      : waiting.length > 0
        ? waiting[0].rule === 'draft.legality.not_on_clock'
          ? `Queue ${top.playerName} so the pick is ready when you are on the clock.`
          : `${waiting[0].message} Queue ${top.playerName} for then.`
        : `Draft ${top.playerName}.`

  const decision: Decision<DraftPickRecommendation> = {
    decision_id: newId(),
    decision_type: 'manager.draft.pick',
    decider_scope: 'user',
    lifecycle_phase: world.status,
    four_answers: { what_happened, why_it_matters, how_confident, what_to_do },
    recommended_actions: actions,
    rule_verdicts: verdicts,
    confidence,
    data_completeness,
    uncertainty_sources: Array.from(new Set(uncertainty)),
    provenance: dco.provenance,
    automation_capable: false,
    explanation: top ? `${why_it_matters} ${what_to_do}` : what_happened,
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
