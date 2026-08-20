/**
 * Decision OS — Trade Intelligence for `manager.trade.evaluate` (Slice 3, multi-team capable).
 *
 * ARCHITECTURE RULE: consumes ONLY the DCO + injected dependencies. No direct prisma / league /
 * snapshot reads — the deterministic evaluation (the persisted snapshot memo) and the Rule Framework
 * are injected. It WRAPS the deterministic evaluator (does not rewrite it), uses ONLY deterministic
 * verdict fields (no AI/prose), and maps the output into a Decision Object that answers the four
 * contract questions. It NEVER executes or mutates a trade.
 *
 * MULTI-TEAM: the legacy evaluator (`buildTradeValueSnapshot`) supports two-team trades only. When the
 * DCO reports `evaluatorSupported === false` (3+ participants), the decision does NOT consume the (then
 * incomplete/wrong) snapshot — it reports the limitation honestly while still answering all four
 * questions. Two-team behavior is unchanged.
 */
import { assertFourAnswers, isLegal, type Decision, type RuleVerdict } from '@/lib/decision-os/core/decision'
import { emitDecisionTelemetry } from '@/lib/decision-os/core/telemetry'
import type { TradeValueSnapshot, SideTotals } from '@/lib/trade-value/types'
import type { TradeDCO, TradeParticipant } from './dco'
import { evaluateTradeRules, type TradeRuleDeps } from './rules'

/** Per-participant deterministic value (multi-team capable). */
export interface ParticipantEvaluation {
  rosterId: string
  sideTotal: number
  /** This participant's total minus the mean of the other participants' totals. */
  valueDelta: number
}

/** A Decision OS trade evaluation (mapped from the deterministic TradeValueSnapshot). */
export interface TradeEvaluation {
  proposalId: string
  participantCount: number
  evaluatorSupported: boolean
  unsupportedReason: string | null
  /** Deterministic overall grade — null when the evaluator does not support this trade (3+ teams). */
  grade: string | null
  fairnessScore: number | null
  confidenceScore: number | null
  valueDifference: number | null
  proposerTotal: number | null
  receiverTotal: number | null
  /** Per-participant deterministic values (every participant, not just two). */
  participants: ParticipantEvaluation[]
  /** rosterId the value leans toward, or 'even', or null when unsupported. */
  leanedTo: string | null
  reviewRecommended: boolean
}

export interface TradeDecisionDeps {
  /** The deterministic evaluator (buildTradeValueSnapshot output) — injected; the persisted memo. */
  evaluate: () => Promise<TradeValueSnapshot>
  ruleDeps: TradeRuleDeps
  newId?: () => string
  lifecyclePhase?: string
}

/** Build per-participant evaluations from snapshot sides (each side's total + delta vs the mean of others). */
export function participantEvalsFromSides(sides: SideTotals[]): ParticipantEvaluation[] {
  const totals = sides.map((s) => s.total)
  const sum = totals.reduce((a, b) => a + b, 0)
  return sides.map((s) => {
    const others = sides.length > 1 ? (sum - s.total) / (sides.length - 1) : 0
    return { rosterId: s.rosterId, sideTotal: s.total, valueDelta: Math.round(s.total - others) }
  })
}

/** Map the deterministic two-team snapshot → a trade evaluation (NO AI/prose consumed). */
export function snapshotToEvaluation(proposalId: string, snap: TradeValueSnapshot): TradeEvaluation {
  const participants = participantEvalsFromSides(snap.sides)
  const proposerTotal = snap.sides[0]?.total ?? 0
  const receiverTotal = snap.sides[1]?.total ?? 0
  const diff = snap.grade.valueDifference
  // Honesty pass: an ungradeable snapshot (no asset resolved to a value) has
  // no lean — 'even' would assert balance the engine never established.
  const leanedTo = snap.grade.insufficientData
    ? null
    : diff > 0
      ? (snap.sides[0]?.rosterId ?? 'proposer')
      : diff < 0
        ? (snap.sides[1]?.rosterId ?? 'receiver')
        : 'even'
  return {
    proposalId,
    participantCount: snap.sides.length,
    evaluatorSupported: true,
    unsupportedReason: snap.grade.insufficientData ? 'insufficient_value_data' : null,
    grade: snap.grade.grade,
    fairnessScore: snap.grade.fairnessScore,
    confidenceScore: snap.grade.confidenceScore,
    valueDifference: diff,
    proposerTotal,
    receiverTotal,
    participants,
    leanedTo,
    reviewRecommended: snap.commissionerReview?.reviewRecommended ?? false,
  }
}

/** Multi-team (unsupported) evaluation — no deterministic grade; per-participant placeholders only. */
function unsupportedEvaluation(proposalId: string, participants: TradeParticipant[]): TradeEvaluation {
  return {
    proposalId,
    participantCount: participants.length,
    evaluatorSupported: false,
    unsupportedReason: 'unsupported_by_legacy_evaluator',
    grade: null,
    fairnessScore: null,
    confidenceScore: null,
    valueDifference: null,
    proposerTotal: null,
    receiverTotal: null,
    participants: participants.map((p) => ({ rosterId: p.rosterId, sideTotal: 0, valueDelta: 0 })),
    leanedTo: null,
    reviewRecommended: true, // 3+ team trades route to commissioner review by default
  }
}

function howConfident(confidence: number, dataCompleteness: number, uncertainty: string[]): string {
  const band = confidence >= 80 ? 'High' : confidence >= 50 ? 'Medium' : 'Low'
  const caveat = uncertainty.length
    ? ` (${dataCompleteness < 100 ? 'data partial — ' : ''}${uncertainty[0].toLowerCase().replace(/\.$/, '')})`
    : ''
  return `${band} confidence${caveat}.`
}

/**
 * Produce the `manager.trade.evaluate` Decision from the DCO. Consumes only the DCO + deps. Read-only.
 */
export async function decideTradeEvaluate(dco: TradeDCO, deps: TradeDecisionDeps): Promise<Decision<TradeEvaluation>> {
  const newId = deps.newId ?? (() => `dec_${Math.random().toString(36).slice(2)}`)

  // Rules (validity before optimality) — READ-ONLY legality gate against the World + assets.
  const verdicts: RuleVerdict[] = await evaluateTradeRules(
    { world: dco.world, assets: dco.assets, snapshotAvailable: dco.world.snapshotAvailable },
    deps.ruleDeps,
  )

  if (!dco.evaluatorSupported) {
    // ── 3+ TEAM: do NOT consume the (incomplete) two-team snapshot; report the limitation honestly ──
    const evaluation = unsupportedEvaluation(dco.proposal.proposalId, dco.participants)
    verdicts.unshift({
      rule: 'trade.unsupported.multi_team',
      verdict: 'requires_approval',
      message: `Multi-team trade (${dco.participantCount} teams) — deterministic grading is not available; commissioner review required.`,
      severity: 'warning',
    })
    const uncertainty = [...dco.uncertainty]
    const decision: Decision<TradeEvaluation> = {
      decision_id: newId(),
      decision_type: 'manager.trade.evaluate',
      decider_scope: 'user',
      lifecycle_phase: deps.lifecyclePhase ?? 'active',
      four_answers: {
        what_happened: `Multi-team trade (${dco.participantCount} teams) detected — deterministic evaluation is not available.`,
        why_it_matters: 'The canonical evaluator grades two-team trades only; per-team value cannot be computed deterministically yet.',
        how_confident: 'Low confidence — unsupported by the legacy evaluator.',
        what_to_do: 'Route to commissioner review; per-team grading will arrive when the evaluator supports 3+ teams.',
      },
      recommended_actions: [evaluation],
      rule_verdicts: verdicts,
      confidence: 10,
      data_completeness: dco.data_completeness,
      uncertainty_sources: Array.from(new Set(uncertainty)),
      provenance: dco.provenance,
      automation_capable: false,
      explanation: `Multi-team trade (${dco.participantCount} teams) is not supported by the deterministic evaluator; routed to commissioner review.`,
      telemetry: { dco_consumed: true, rule_gated: true, decision_object_emitted: true, explainable: true, world_resolution_read_only: true },
    }
    assertFourAnswers(decision)
    emitDecisionTelemetry('decision.issued', decision.decision_type, { ...decision.telemetry, legal: isLegal(verdicts), evaluator_supported: false, participant_count: dco.participantCount }, decision.decision_id)
    return decision
  }

  // ── TWO-TEAM: wrap the deterministic snapshot (unchanged behavior) ──
  const snapshot = await deps.evaluate()
  const evaluation = snapshotToEvaluation(dco.proposal.proposalId, snapshot)
  const illegal = verdicts.filter((v) => v.verdict === 'illegal')
  const blocked = verdicts.filter((v) => v.verdict === 'temporarily_illegal')

  const data_completeness = dco.data_completeness
  const confidence = Math.max(0, Math.min(100, Math.round(Math.min(evaluation.confidenceScore ?? 0, data_completeness))))
  const uncertainty = [...dco.uncertainty]
  const how_confident = howConfident(confidence, data_completeness, uncertainty)

  const fairness = evaluation.fairnessScore ?? 0
  const fairnessLabel = fairness >= 85 ? 'fair' : fairness >= 65 ? 'slightly uneven' : 'lopsided'
  const leanLabel = evaluation.leanedTo === 'even' ? 'even' : evaluation.leanedTo === snapshot.sides[0]?.rosterId ? 'proposer' : 'receiver'
  const what_happened = `Trade graded ${evaluation.grade} — ${fairnessLabel} (fairness ${fairness}/100).`
  const why_it_matters = illegal.length
    ? illegal[0].message
    : evaluation.leanedTo === 'even'
      ? 'Both sides receive near-equal deterministic value.'
      : `Value leans toward the ${leanLabel} by ${Math.abs(evaluation.valueDifference ?? 0)}.`
  const what_to_do = illegal.length
    ? illegal[0].message
    : blocked.length
      ? blocked[0].message
      : evaluation.reviewRecommended
        ? 'Commissioner review is recommended before this trade is accepted.'
        : fairness >= 85
          ? 'This trade is balanced — reasonable to accept.'
          : `Consider a counter — the ${leanLabel} currently gains more value.`

  const decision: Decision<TradeEvaluation> = {
    decision_id: newId(),
    decision_type: 'manager.trade.evaluate',
    decider_scope: 'user',
    lifecycle_phase: deps.lifecyclePhase ?? 'active',
    four_answers: { what_happened, why_it_matters, how_confident, what_to_do },
    recommended_actions: [evaluation],
    rule_verdicts: verdicts,
    confidence,
    data_completeness,
    uncertainty_sources: Array.from(new Set(uncertainty)),
    provenance: dco.provenance,
    automation_capable: false, // Slice 3: Decision OS NEVER executes/accepts/processes a trade
    explanation: `${what_happened} ${why_it_matters} ${what_to_do}`,
    telemetry: {
      dco_consumed: true,
      rule_gated: true,
      decision_object_emitted: true,
      explainable: true,
      world_resolution_read_only: true,
    },
  }

  assertFourAnswers(decision)
  emitDecisionTelemetry('decision.issued', decision.decision_type, { ...decision.telemetry, legal: isLegal(verdicts), evaluator_supported: true, participant_count: dco.participantCount }, decision.decision_id)
  return decision
}
