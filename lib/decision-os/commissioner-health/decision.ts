/**
 * Decision OS — Commissioner Intelligence for `commissioner.league.health` (Slice 4).
 *
 * ARCHITECTURE RULE: consumes ONLY the DCO + injected dependencies. No direct prisma / league /
 * snapshot reads — the deterministic evaluation (the built snapshot memo) and the Rule Framework are
 * injected. It WRAPS the deterministic health snapshot (does not recompute health), uses ONLY
 * deterministic score fields (no AI/prose), and maps the output into a Decision Object that answers
 * the four contract questions. ASSESSMENT ONLY — it NEVER executes a commissioner action or mutates
 * league state (`automation_capable: false`). Commissioner-scoped.
 */
import { assertFourAnswers, isLegal, type Decision, type RuleVerdict } from '@/lib/decision-os/core/decision'
import { emitDecisionTelemetry } from '@/lib/decision-os/core/telemetry'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'

type OverallStatus = CommissionerLeagueHealthSnapshot['overallStatus']
import type { CommissionerHealthDCO } from './dco'
import { evaluateCommissionerHealthRules, deriveCommissionerRiskScores } from './rules'

/** A read-only commissioner action SUGGESTION (navigation only — never executed by the Decision OS). */
export interface CommissionerActionSuggestion {
  key: string
  label: string
  href: string
  tone: string
}

/** The Decision OS health assessment (mapped from the deterministic snapshot). */
export interface CommissionerHealthAssessment {
  leagueId: string
  healthScore: number
  engagementScore: number
  fairnessScore: number
  sustainabilityScore: number
  overallStatus: OverallStatus
  churnRiskScore: number
  disputeRiskScore: number
  abandonmentRiskScore: number
  topAlerts: string[]
  recommendations: string[]
  /** Suggestions only — the UI/commissioner acts on these; the Decision OS never does. */
  suggestedActions: CommissionerActionSuggestion[]
}

export interface CommissionerHealthDecisionDeps {
  /** The deterministic evaluator (the built CommissionerLeagueHealthSnapshot) — injected; the memo. */
  evaluate: () => Promise<CommissionerLeagueHealthSnapshot>
  newId?: () => string
  lifecyclePhase?: string
}

/** Map the deterministic snapshot → an assessment (NO AI/prose consumed; risk derived from memo). */
export function snapshotToAssessment(snapshot: CommissionerLeagueHealthSnapshot): CommissionerHealthAssessment {
  const risk = deriveCommissionerRiskScores(snapshot)
  return {
    leagueId: snapshot.leagueId,
    healthScore: snapshot.healthScore,
    engagementScore: snapshot.engagementScore,
    fairnessScore: snapshot.fairnessScore,
    sustainabilityScore: snapshot.sustainabilityScore,
    overallStatus: snapshot.overallStatus,
    churnRiskScore: risk.churnRiskScore,
    disputeRiskScore: risk.disputeRiskScore,
    abandonmentRiskScore: risk.abandonmentRiskScore,
    topAlerts: snapshot.alerts.slice(0, 4),
    recommendations: snapshot.recommendations.slice(0, 4),
    suggestedActions: snapshot.actions.map((a) => ({ key: a.key, label: a.label, href: a.href, tone: a.tone })),
  }
}

function howConfident(dataCompleteness: number, uncertainty: string[]): string {
  const band = dataCompleteness >= 90 ? 'High' : dataCompleteness >= 70 ? 'Medium' : 'Low'
  const caveat = uncertainty.length ? ` (${uncertainty[0].toLowerCase().replace(/\.$/, '')})` : ''
  return `${band} confidence${caveat}.`
}

/**
 * Produce the `commissioner.league.health` Decision from the DCO. Consumes only the DCO + deps.
 * Read-only assessment.
 */
export async function decideCommissionerHealth(
  dco: CommissionerHealthDCO,
  deps: CommissionerHealthDecisionDeps,
): Promise<Decision<CommissionerHealthAssessment>> {
  const newId = deps.newId ?? (() => `dec_${Math.random().toString(36).slice(2)}`)

  // 1) Evaluation (deterministic snapshot memo, injected) — score fields ONLY.
  const snapshot = await deps.evaluate()
  const assessment = snapshotToAssessment(snapshot)

  // 2) Rules (assessment, not legality) — deterministic threshold → commissioner-attention verdicts.
  const verdicts: RuleVerdict[] = evaluateCommissionerHealthRules(snapshot)
  const attention = verdicts.filter((v) => v.verdict === 'requires_approval')
  const critical = attention.filter((v) => v.severity === 'critical')

  // 3) Four answers (grounded in the DCO + deterministic snapshot + verdicts).
  const data_completeness = dco.data_completeness
  const uncertainty = [...dco.uncertainty]
  const how_confident = howConfident(data_completeness, uncertainty)

  const what_happened = `League health is ${assessment.healthScore}/100 (${assessment.overallStatus}).`
  const why_it_matters = critical.length
    ? critical[0].message
    : attention.length
      ? attention[0].message
      : assessment.topAlerts[0]
        ?? (assessment.overallStatus === 'excellent' || assessment.overallStatus === 'healthy'
          ? 'Engagement, fairness, and sustainability are all in healthy ranges.'
          : 'No critical issues, but some signals are worth monitoring.')
  const what_to_do = assessment.recommendations[0]
    ?? (attention.length
      ? 'Review the flagged league-health items in the Commissioner Hub.'
      : 'No commissioner action needed right now — keep monitoring.')

  const decision: Decision<CommissionerHealthAssessment> = {
    decision_id: newId(),
    decision_type: 'commissioner.league.health',
    decider_scope: 'commissioner',
    lifecycle_phase: deps.lifecyclePhase ?? 'active',
    four_answers: { what_happened, why_it_matters, how_confident, what_to_do },
    recommended_actions: [assessment],
    rule_verdicts: verdicts,
    confidence: data_completeness, // assessment confidence tracks data completeness/confidence
    data_completeness,
    uncertainty_sources: Array.from(new Set(uncertainty)),
    provenance: dco.provenance,
    automation_capable: false, // Slice 4: Decision OS NEVER executes a commissioner action / mutates state
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
  emitDecisionTelemetry(
    'decision.issued',
    decision.decision_type,
    {
      ...decision.telemetry,
      legal: isLegal(verdicts),
      decider_scope: 'commissioner',
      overall_status: assessment.overallStatus,
      userId: dco.user.userId,
      leagueId: dco.league.leagueId,
    },
    decision.decision_id,
  )
  return decision
}
