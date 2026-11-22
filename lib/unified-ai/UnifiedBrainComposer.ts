/**
 * UnifiedBrainComposer — composes one final response from deterministic + DeepSeek + Grok + OpenAI.
 * Deterministic first; then analytical (DeepSeek), narrative (Grok), final explanation (OpenAI).
 */

import type { AIContextEnvelope, ModelOutput, OrchestrationResult } from "./types"
import { evaluateConsensus } from "./ConsensusEvaluator"
import { resolveConfidence } from "./AIConfidenceResolver"
import { applyFactGuardToAnswer } from "./AIFactGuard"
import { deterministicPayloadToContextSummary, type DeterministicSource } from "./DeterministicToAIContextBridge"

interface UnifiedBrainInput {
  envelope: AIContextEnvelope
  modelOutputs: ModelOutput[]
  deterministicSource?: DeterministicSource
}

/**
 * Compose a single OrchestrationResult from envelope and model outputs.
 * Applies fact guard and confidence resolution.
 */
export function composeUnifiedBrain(input: UnifiedBrainInput): OrchestrationResult {
  const { envelope, modelOutputs, deterministicSource } = input
  const usedDeterministic = !!envelope.deterministicPayload

  const deterministicSummary =
    usedDeterministic && envelope.deterministicPayload && deterministicSource
      ? deterministicPayloadToContextSummary(envelope.deterministicPayload, deterministicSource)
      : undefined

  const consensus = evaluateConsensus({
    modelOutputs,
    preferModel: "openai",
    deterministicSummary,
  })

  const confidence = resolveConfidence(envelope, modelOutputs)
  const { answer: primaryAnswer, factGuardWarnings } = applyFactGuardToAnswer(
    envelope,
    consensus.primaryAnswer
  )

  const mergedWarnings = [...factGuardWarnings]
  const missing = envelope.dataQualityMetadata?.missing
  if (missing?.length) {
    mergedWarnings.push("Context limited: " + missing.slice(0, 5).join(", ") + " unavailable or from fallback. Do not invent.")
  }

  return {
    mode: "unified_brain",
    primaryAnswer,
    confidencePct: confidence.scorePct,
    confidenceLabel: confidence.label,
    reason: consensus.reason,
    modelOutputs,
    usedDeterministic,
    factGuardWarnings: mergedWarnings.length ? mergedWarnings : undefined,
  }
}
