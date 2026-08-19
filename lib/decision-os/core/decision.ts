/**
 * Decision OS — the Canonical Decision Object (Slice 1).
 *
 * Every Decision answers EXACTLY four questions (the Decision Contract); everything else is
 * metadata. This type is decision-type-agnostic so `manager.waiver.claim`, `manager.trade.evaluate`,
 * etc. (Slices 2+) reuse it unchanged. No I/O here — pure types + invariants.
 */

export type DeciderScope = 'user' | 'commissioner' | 'operator'

/** The four mandatory answers. If any is empty, it is not a Decision (assertFourAnswers throws). */
export interface FourAnswers {
  what_happened: string
  why_it_matters: string
  how_confident: string
  what_to_do: string
}

export type RuleVerdictType = 'legal' | 'illegal' | 'temporarily_illegal' | 'requires_approval'
export type VerdictSeverity = 'critical' | 'warning' | 'info'

export interface RuleVerdict {
  rule: string
  verdict: RuleVerdictType
  message: string
  severity: VerdictSeverity
}

export interface DecisionProvenance {
  /** The weakest required input drives confidence/completeness honesty. */
  weakest_source: string
  weakest_trust: 'authoritative' | 'high' | 'medium' | 'low' | 'unverified'
}

export interface DecisionTelemetryFlags {
  dco_consumed: boolean
  rule_gated: boolean
  decision_object_emitted: boolean
  explainable: boolean
  world_resolution_read_only: boolean
}

export interface Decision<TAction = unknown> {
  decision_id: string
  decision_type: string
  decider_scope: DeciderScope
  /** Lifecycle/real-world time stamp (phase) for the decision. */
  lifecycle_phase: string
  four_answers: FourAnswers
  recommended_actions: TAction[]
  rule_verdicts: RuleVerdict[]
  /** 0–100, calibrated (placeholder calibration in Slice 1). */
  confidence: number
  /** 0–100 — how complete the inputs were (separate from confidence). */
  data_completeness: number
  uncertainty_sources: string[]
  provenance: DecisionProvenance
  automation_capable: boolean
  /** Plain-language "why", safe for the Today Card. Never exposes models/AI. */
  explanation: string
  telemetry: DecisionTelemetryFlags
}

/** True when no rule returned an `illegal` verdict. */
export function isLegal(verdicts: RuleVerdict[]): boolean {
  return verdicts.every((v) => v.verdict !== 'illegal')
}

/** Invariant: a Decision must populate all four contract answers. */
export function assertFourAnswers(d: Pick<Decision, 'four_answers'>): void {
  const a = d.four_answers
  const missing = (['what_happened', 'why_it_matters', 'how_confident', 'what_to_do'] as const).filter(
    (k) => !a?.[k] || String(a[k]).trim().length === 0,
  )
  if (missing.length > 0) {
    throw new Error(`Decision Contract violation — missing four-answer fields: ${missing.join(', ')}`)
  }
}
