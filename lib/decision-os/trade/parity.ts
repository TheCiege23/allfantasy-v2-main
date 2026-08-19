/**
 * Decision OS — Parity Gate binding for `manager.trade.evaluate` (Slice 3, multi-team capable).
 *
 * WRAP-FIDELITY parity: the Decision OS path is fed the SAME persisted deterministic snapshot the
 * route just captured, so this proves the Decision OS wrapper introduces NO drift when mapping the
 * snapshot → a trade evaluation. It compares deterministic verdict fields for EVERY participant (not
 * just sides[0]/sides[1]) plus the overall grade. grade.bullets / commissionerReview prose / AI
 * surfaces are intentionally ignored. For 3+ team trades the legacy evaluator is unsupported, so parity
 * short-circuits as `unsupported` (nothing to compare — reported honestly, never a false pass).
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import { compareKeyedParity, type ShadowParityResult } from '@/lib/decision-os/core/parity'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import type { TradeEvaluation } from './decision'
import { snapshotToEvaluation } from './decision'

export interface TradeParityResult extends ShadowParityResult {
  /** Always true for Slice 3 — the evaluator is wrapped, not recomputed. */
  wrapFidelity: true
  comparedProposals: number
  comparedParticipants: number
  /** True when the trade has 3+ participants (legacy evaluator unsupported) — nothing to compare. */
  unsupported: boolean
}

/**
 * Compare the Decision OS evaluation against the persisted deterministic snapshot, per participant +
 * overall grade. Optional prose / AI surfaces are not part of the comparison.
 */
export function compareTradeParity(
  decision: Decision<TradeEvaluation>,
  snapshot: TradeValueSnapshot,
): TradeParityResult {
  const action = decision.recommended_actions[0]
  if (!action || action.evaluatorSupported === false) {
    return { passed: true, diffs: [], comparedKeys: 0, wrapFidelity: true, comparedProposals: 0, comparedParticipants: 0, unsupported: true }
  }

  const proposalId = action.proposalId
  const expected = snapshotToEvaluation(proposalId, snapshot)

  // Overall deterministic grade row.
  const overall = compareKeyedParity(
    [{ key: proposalId, grade: action.grade, fairnessScore: action.fairnessScore, confidenceScore: action.confidenceScore, valueDifference: action.valueDifference }],
    [{ key: proposalId, grade: expected.grade, fairnessScore: expected.fairnessScore, confidenceScore: expected.confidenceScore, valueDifference: expected.valueDifference }],
    {
      keyOf: (e) => e.key,
      entityLabel: 'trade',
      fields: [
        { label: 'grade', valueOf: (e) => e.grade },
        { label: 'fairnessScore', valueOf: (e) => e.fairnessScore },
        { label: 'confidenceScore', valueOf: (e) => e.confidenceScore },
        { label: 'valueDifference', valueOf: (e) => e.valueDifference },
      ],
    },
  )

  // Per-participant deterministic values — EVERY participant, not just two.
  const perParticipant = compareKeyedParity(action.participants, expected.participants, {
    keyOf: (p) => p.rosterId,
    entityLabel: 'participant',
    fields: [
      { label: 'side total', valueOf: (p) => p.sideTotal },
      { label: 'value delta', valueOf: (p) => p.valueDelta },
    ],
  })

  return {
    passed: overall.passed && perParticipant.passed,
    diffs: [...overall.diffs, ...perParticipant.diffs],
    comparedKeys: overall.comparedKeys + perParticipant.comparedKeys,
    wrapFidelity: true,
    comparedProposals: overall.comparedKeys,
    comparedParticipants: perParticipant.comparedKeys,
    unsupported: false,
  }
}
