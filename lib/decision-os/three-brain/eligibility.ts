/**
 * Deterministic Claude eligibility policy. Claude is a SELECTIVE reviewer / fallback — it does NOT run on
 * every request. The server decides eligibility from observable conditions only; the models never vote on
 * whether Claude runs.
 *
 * This module implements the POLICY CONTRACT only. It invents no entitlements, token costs, prices, or tiers.
 * In ordinary standalone execution the caller supplies no policy, so `highStakesPremium` / `explicitReview`
 * are absent and a request is NOT automatically treated as premium — review triggers only on genuine
 * disagreement or low server confidence. A future authorized caller may pass a policy to request review or
 * mark a decision high-stakes; wiring that authorization is a later phase, not this one.
 */
import type { AgreementState, DecisionOSEvidencePacket, SpecialistEvaluation } from './types'

/**
 * At/below this server confidence, a second opinion is warranted. Set to the disagreement base (45): a
 * decision this uncertain is, by the server's own scale, as shaky as an outright specialist disagreement.
 * Consensus/partial_consensus with adequate evidence stays above it and does NOT auto-invoke Claude.
 */
export const DEFAULT_CLAUDE_CONFIDENCE_THRESHOLD = 45

/**
 * Caller-supplied review policy. All fields are OPTIONAL and default to off — standalone execution passes
 * none, so Claude is not treated as premium by default. These are policy inputs, NOT entitlements: this
 * module does not check tiers, spend tokens, or price anything.
 */
export type ClaudeReviewPolicy = {
  /** A future authorized caller explicitly requested an independent Claude review. Default: absent. */
  explicitReviewRequested?: boolean
  /** The caller classified this decision as high-stakes premium. Default: absent (NOT premium by default). */
  highStakesPremium?: boolean
  /** Override the confidence threshold. Default: DEFAULT_CLAUDE_CONFIDENCE_THRESHOLD. */
  confidenceThreshold?: number
}

export type ClaudeReviewEligibility = {
  eligible: boolean
  /** Deterministic triggers that fired (for non-sensitive telemetry / explanation). */
  triggers: string[]
}

/**
 * REVIEW eligibility — evaluated ONLY when the OpenAI synthesis succeeded. Returns which deterministic
 * conditions fired. Conditions: specialist disagreement, server confidence below threshold, an explicit
 * caller request, or a caller-marked high-stakes premium decision. None present → Claude does not run.
 */
export function evaluateClaudeReviewEligibility(input: {
  agreementState: AgreementState
  confidencePct?: number
  policy?: ClaudeReviewPolicy
}): ClaudeReviewEligibility {
  const threshold = input.policy?.confidenceThreshold ?? DEFAULT_CLAUDE_CONFIDENCE_THRESHOLD
  const triggers: string[] = []
  if (input.agreementState === 'disagreement') triggers.push('specialist_disagreement')
  if (typeof input.confidencePct === 'number' && input.confidencePct <= threshold) triggers.push('low_confidence')
  if (input.policy?.highStakesPremium) triggers.push('high_stakes_premium')
  if (input.policy?.explicitReviewRequested) triggers.push('explicit_request')
  return { eligible: triggers.length > 0, triggers }
}

/**
 * FALLBACK eligibility — evaluated ONLY when the OpenAI synthesis failed/timed out. Claude may synthesize
 * from the same verified evidence + specialist evaluations, but ONLY when usable material remains (so it is
 * grounded and never invents). No material → deterministic-only, not a Claude call. Reaching this path
 * already implies at least one specialist contributed (both-failed short-circuits earlier), but the evidence
 * check keeps the function honest and self-contained.
 */
export function shouldRunClaudeFallback(input: {
  packet: DecisionOSEvidencePacket
  deepseek: SpecialistEvaluation
  grok: SpecialistEvaluation
}): boolean {
  const specialistMaterial = input.deepseek.status !== 'failed' || input.grok.status !== 'failed'
  const evidenceMaterial = input.packet.deterministicSignals.length > 0 || input.packet.relevantFacts.length > 0
  return specialistMaterial || evidenceMaterial
}
