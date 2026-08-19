/**
 * Decision OS — Lineup Intelligence for `manager.lineup.set` (Slice 1).
 *
 * ARCHITECTURE RULE: this module consumes ONLY the DCO + injected dependencies. It performs NO
 * direct prisma / league / scoring reads — the recommender (computeLineupActionsForUser) and the
 * Rule Framework are injected. It WRAPS the canonical recommender (does not rewrite it) and maps
 * its output into a Decision Object that answers the four contract questions.
 */
import type { LineupActionItem, LineupActionSummaryPayload } from '@/lib/lineup-actions/types'
import { assertFourAnswers, isLegal, type Decision, type RuleVerdict } from '@/lib/decision-os/core/decision'
import { emitDecisionTelemetry } from '@/lib/decision-os/core/telemetry'
import type { LineupDCO } from './dco'
import { evaluateLineupRules, type LineupRuleDeps } from './rules'

export interface LineupDecisionDeps {
  /** The canonical recommender (computeLineupActionsForUser) — injected; does the I/O. */
  recommend: (userId: string) => Promise<LineupActionSummaryPayload>
  ruleDeps?: LineupRuleDeps
  newId?: () => string
  lifecyclePhase?: string
}

function countable(a: LineupActionItem): boolean {
  return a.reasonType !== 'fetch_error' && a.severity !== 'info'
}

function deriveConfidence(actions: LineupActionItem[], dataCompleteness: number, clean: boolean): number {
  if (clean) return Math.min(95, dataCompleteness)
  const vals = actions.map((a) => a.confidence).filter((c): c is number => typeof c === 'number')
  if (vals.length === 0) return Math.min(75, dataCompleteness)
  const avg = vals.reduce((s, c) => s + (c <= 1 ? c * 100 : c), 0) / vals.length
  return Math.max(0, Math.min(100, Math.round(Math.min(avg, dataCompleteness))))
}

function howConfident(confidence: number, dataCompleteness: number, uncertainty: string[]): string {
  const band = confidence >= 80 ? 'High' : confidence >= 50 ? 'Medium' : 'Low'
  const caveat = uncertainty.length
    ? ` (${dataCompleteness < 100 ? 'data partial — ' : ''}${uncertainty[0].toLowerCase().replace(/\.$/, '')})`
    : ''
  return `${band} confidence${caveat}.`
}

/**
 * Produce the `manager.lineup.set` Decision from the DCO. Consumes only the DCO + deps.
 */
export async function decideLineupSet(dco: LineupDCO, deps: LineupDecisionDeps): Promise<Decision<LineupActionItem>> {
  const newId = deps.newId ?? (() => `dec_${Math.random().toString(36).slice(2)}`)

  // 1) Recommendation (canonical recommender, injected) — filter to this league.
  const payload = await deps.recommend(dco.user.userId)
  const actions = (payload.actions ?? []).filter((a) => a.leagueId === dco.league.leagueId)
  const leagueBlock = (payload.leagues ?? []).find((l) => l.leagueId === dco.league.leagueId)
  const scanIncomplete = Boolean(leagueBlock?.scanIncomplete)

  // 2) Rules (validity before optimality) — from the DCO's world + proposed lineup.
  const verdicts: RuleVerdict[] = evaluateLineupRules(
    {
      sport: dco.league.sport,
      week: dco.world.week,
      players: dco.lineup.proposed,
      rosterConfig: dco.world.facts.rosterConfig,
      lockState: dco.lock_state,
    },
    deps.ruleDeps,
  )
  const illegal = verdicts.filter((v) => v.verdict === 'illegal')
  const actionable = actions.filter(countable)
  const clean = actionable.length === 0 && illegal.length === 0

  // 3) Four answers (grounded in the DCO + recommender + verdicts).
  const top = actionable.sort((a, b) => (b.expectedGain ?? 0) - (a.expectedGain ?? 0))[0]
  const what_happened = clean
    ? 'Your lineup is set — nothing needs attention.'
    : `${actionable.length || illegal.length} lineup action(s) need attention before lock.`
  let why_it_matters = clean
    ? 'Your lineup is legal and complete for this scoring period.'
    : illegal.length
      ? illegal[0].message
      : (top?.message ?? 'A starter slot needs attention before it locks.')

  // Warehouse grounding (ADR F2.10): cite STORED facts in the explanation when they exist.
  // Explainability consumes facts, it never creates them (P8) — every number below is a real
  // warehouse row aggregate; when the warehouse has nothing, no sentence is added and the
  // gap already sits in uncertainty_sources via the DCO.
  if (dco.warehouse?.performance) {
    const perf = dco.warehouse.performance
    const lead = perf.cited[0]
    const seasonNote = perf.seasonMismatch ? ` (${perf.seasonUsed} season data)` : ''
    why_it_matters += ` Grounded in stored results${seasonNote}: ${perf.playersWithHistory} of ${perf.totalPlayers} roster players have game history${
      lead ? `; top recent form ${lead.recentFormAvg.toFixed(1)} pts over ${lead.gamesPlayed} games` : ''
    }.`
  }
  if (dco.warehouse?.matchup) {
    const current = dco.warehouse.matchup.currentSeason
    const record = current.wins != null
      ? `${current.wins}-${current.losses}${current.ties ? `-${current.ties}` : ''} over ${current.sampleSize} completed matchups`
      : null
    if (record) {
      why_it_matters += ` This team's stored current-season record is ${record} (avg margin ${current.averageMargin?.toFixed(1)}).`
    } else if (dco.warehouse.matchup.historical.sampleSize > 0) {
      why_it_matters += ` Stored matchup history exists for earlier seasons only (${dco.warehouse.matchup.historical.sampleSize} completed matchups).`
    }
  }
  const data_completeness = scanIncomplete ? Math.min(dco.data_completeness, 60) : dco.data_completeness
  const confidence = deriveConfidence(actionable, data_completeness, clean)
  const uncertainty = [...dco.uncertainty, ...(scanIncomplete ? ['Live lineup data could not be fully verified.'] : [])]
  const how_confident = howConfident(confidence, data_completeness, uncertainty)
  const what_to_do = clean
    ? "You're all caught up."
    : (top?.recommendedAction ?? illegal[0]?.message ?? 'Review and set your lineup before lock.')

  const decision: Decision<LineupActionItem> = {
    decision_id: newId(),
    decision_type: 'manager.lineup.set',
    decider_scope: 'user',
    lifecycle_phase: deps.lifecyclePhase ?? 'active',
    four_answers: { what_happened, why_it_matters, how_confident, what_to_do },
    recommended_actions: actionable, // the canonical recommender's items, unchanged
    rule_verdicts: verdicts,
    confidence,
    data_completeness,
    uncertainty_sources: Array.from(new Set(uncertainty)),
    provenance: dco.provenance,
    automation_capable: true, // autocoach/auto-sub can execute lineup protection
    explanation: clean ? what_happened : `${why_it_matters} ${what_to_do}`,
    telemetry: {
      dco_consumed: true,
      rule_gated: true,
      decision_object_emitted: true,
      explainable: true,
      world_resolution_read_only: true,
    },
  }

  assertFourAnswers(decision)
  emitDecisionTelemetry('decision.issued', decision.decision_type, { ...decision.telemetry, legal: isLegal(verdicts) }, decision.decision_id)
  return decision
}
