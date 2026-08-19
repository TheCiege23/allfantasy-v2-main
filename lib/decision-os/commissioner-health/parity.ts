/**
 * Decision OS — Parity Gate binding for `commissioner.league.health` (Slice 4).
 *
 * WRAP-FIDELITY parity: the Decision OS path is fed the SAME built deterministic snapshot the
 * assembler produced, so this proves the Decision OS wrapper introduces NO drift when mapping the
 * snapshot → an assessment. Keyed by league, comparing the deterministic score fields only — prose
 * `summary`, `assistantQuestions`, action labels, and AI commissioner insights are ignored. Risk
 * scores are derived from the same memo on both sides (faithful re-derivation, like trade's valueDelta).
 */
import type { Decision } from '@/lib/decision-os/core/decision'
import { compareKeyedParity, type ShadowParityResult } from '@/lib/decision-os/core/parity'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { CommissionerHealthAssessment } from './decision'
import { snapshotToAssessment } from './decision'

export interface CommissionerHealthParityResult extends ShadowParityResult {
  /** Always true for Slice 4 — the evaluator is wrapped, not recomputed. */
  wrapFidelity: true
  comparedLeagues: number
}

/**
 * Compare the Decision OS assessment against the built deterministic snapshot (mapped through the
 * same pure adapter). Prose / AI surfaces are not part of the comparison.
 */
export function compareCommissionerHealthParity(
  decision: Decision<CommissionerHealthAssessment>,
  snapshot: CommissionerLeagueHealthSnapshot,
): CommissionerHealthParityResult {
  const expected = [snapshotToAssessment(snapshot)]
  const result = compareKeyedParity(decision.recommended_actions, expected, {
    keyOf: (a) => a.leagueId,
    entityLabel: 'league',
    fields: [
      { label: 'healthScore', valueOf: (a) => a.healthScore },
      { label: 'engagementScore', valueOf: (a) => a.engagementScore },
      { label: 'fairnessScore', valueOf: (a) => a.fairnessScore },
      { label: 'sustainabilityScore', valueOf: (a) => a.sustainabilityScore },
      { label: 'overallStatus', valueOf: (a) => a.overallStatus },
      { label: 'churnRiskScore', valueOf: (a) => a.churnRiskScore },
      { label: 'disputeRiskScore', valueOf: (a) => a.disputeRiskScore },
      { label: 'abandonmentRiskScore', valueOf: (a) => a.abandonmentRiskScore },
    ],
  })
  return { ...result, wrapFidelity: true, comparedLeagues: result.comparedKeys }
}
