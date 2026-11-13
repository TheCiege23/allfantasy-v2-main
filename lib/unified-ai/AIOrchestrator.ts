/**
 * AIOrchestrator — entry point for unified AI execution.
 * Dispatches by mode (single_model, specialist, consensus, unified_brain) and returns OrchestrationResult.
 * Does not call APIs itself; callers (route handlers) run the actual model calls and pass ModelOutput[].
 */

import type { AIContextEnvelope, ModelOutput, OrchestrationResult, OrchestrationMode } from "./types"
import { resolveOrchestrationMode, resolveSingleModel, resolveSpecialistPair, resolveModelsForConsensus } from "./ModelRoutingResolver"
import { evaluateConsensus } from "./ConsensusEvaluator"
import { composeUnifiedBrain } from "./UnifiedBrainComposer"
import { resolveConfidence } from "./AIConfidenceResolver"
import { applyFactGuardToAnswer } from "./AIFactGuard"

type OrchestratorInput = {
  envelope: AIContextEnvelope
  /** Pre-run model outputs (caller runs APIs and passes results). */
  modelOutputs: ModelOutput[]
  /** Optional override for mode. */
  mode?: OrchestrationMode
  /** For unified_brain: deterministic source label. */
  deterministicSource?: Parameters<typeof composeUnifiedBrain>[0]["deterministicSource"]
}

/**
 * Run orchestration: given envelope and already-fetched model outputs, produce one result.
 * Use this from route handlers that run OpenAI/DeepSeek/Grok themselves (e.g. Chimmy, graph-insight).
 */
export function runOrchestration(input: OrchestratorInput): OrchestrationResult {
  const { envelope, modelOutputs, mode: modeOverride, deterministicSource } = input
  const mode = modeOverride ?? resolveOrchestrationMode(envelope)

  const mergeDataQualityWarnings = (warnings: string[] | undefined): string[] => {
    const out = [...(warnings ?? [])]
    const missing = envelope.dataQualityMetadata?.missing
    if (missing?.length) {
      out.push("Context limited: " + missing.slice(0, 5).join(", ") + " unavailable or from fallback. Do not invent.")
    }
    return out
  }

  if (mode === "single_model") {
    const single = resolveSingleModel(envelope)
    const out = modelOutputs.find((o) => o.model === single) ?? modelOutputs[0]
    const text = out?.raw?.trim() ?? "No response available."
    const confidence = resolveConfidence(envelope, modelOutputs)
    const { answer, factGuardWarnings } = applyFactGuardToAnswer(envelope, text)
    return {
      mode: "single_model",
      primaryAnswer: answer,
      confidencePct: confidence.scorePct,
      confidenceLabel: confidence.label,
      reason: `Single model: ${single}`,
      modelOutputs,
      usedDeterministic: !!envelope.deterministicPayload,
      factGuardWarnings: mergeDataQualityWarnings(factGuardWarnings),
    }
  }

  if (mode === "specialist") {
    const { analysis, explanation } = resolveSpecialistPair(envelope)
    const analysisOut = modelOutputs.find((o) => o.model === analysis)
    const explanationOut = modelOutputs.find((o) => o.model === explanation)
    const text = (explanationOut?.raw ?? analysisOut?.raw ?? "").trim() || "No response available."
    const confidence = resolveConfidence(envelope, modelOutputs)
    const { answer, factGuardWarnings } = applyFactGuardToAnswer(envelope, text)
    return {
      mode: "specialist",
      primaryAnswer: answer,
      confidencePct: confidence.scorePct,
      confidenceLabel: confidence.label,
      reason: `Specialist: ${analysis} + ${explanation}`,
      modelOutputs,
      usedDeterministic: !!envelope.deterministicPayload,
      factGuardWarnings: mergeDataQualityWarnings(factGuardWarnings),
    }
  }

  if (mode === "consensus") {
    const consensus = evaluateConsensus({
      modelOutputs,
      preferModel: "openai",
      deterministicSummary: envelope.deterministicPayload
        ? JSON.stringify(envelope.deterministicPayload).slice(0, 400)
        : undefined,
    })
    const confidence = resolveConfidence(envelope, modelOutputs)
    const { answer, factGuardWarnings } = applyFactGuardToAnswer(envelope, consensus.primaryAnswer)
    return {
      mode: "consensus",
      primaryAnswer: answer,
      confidencePct: confidence.scorePct,
      confidenceLabel: confidence.label,
      reason: consensus.reason,
      modelOutputs,
      usedDeterministic: !!envelope.deterministicPayload,
      factGuardWarnings: mergeDataQualityWarnings(factGuardWarnings),
    }
  }

  return composeUnifiedBrain({
    envelope,
    modelOutputs,
    deterministicSource,
  })
}
